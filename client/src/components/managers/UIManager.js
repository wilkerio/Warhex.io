import { BuildingTypes, BuildingVariantTypes, calculateRequiredXP, getAvailableBuildingUpgrades, getBuildingDetails, getColorForLevel, PLAYER_NAME_MAX_BYTES, Servers, UnitTypes } from "../../network/constants.js";
import Network from "../../network/Network.js";
import SkinCache from "../SkinCache.js";
import * as supabaseClientApi from "../../network/supabaseClient.js";
import { signUp, signIn, signInWithDiscord, updateAuthNickname, getCurrentUser, fetchSkins, updateSelectedSkin, publishBaseLayout, fetchPublicBaseLayouts, fetchGlobalAccountLeaderboard, fetchUserHudSettings, upsertUserHudSettings, resendSignupConfirmation } from "../../network/supabaseClient.js";
import { BuildingManager } from "./BuildingManager.js";
import ThemeManager from "./ThemeManager.js";
import UnitManager from "./UnitManager.js";
import LanguageManager from "./LanguageManager.js";

const fetchPublicBaseLayoutByIdSafe = async (layoutId) => {
    if (typeof supabaseClientApi?.fetchPublicBaseLayoutById === "function") {
        return supabaseClientApi.fetchPublicBaseLayoutById(layoutId);
    }
    return { success: false, data: null, error: "detail_fetch_unavailable" };
};

/*
    TODO:
        - Make a general show function instead of 20 seperate ones
          ->func(element, show)
        - Maybe seperate some functionality of the UIManager in smaller Parts
          see MiniMap.js / Leaderboard.js (originally part of UIManager)
*/

export default class UIManager {
    constructor (core) {
        this.core = core;
        this.languageManager = new LanguageManager();
        this.loadingOverlay = null;
        this.timerInterval = null;
        this.lastSendMessage = "";
        this.lastSendMessageAt = 0;
        this.chatSendHistory = [];
        this.isDraggingChat = false;
        this.isChatInputFocused = false;
        this.upgradePreviewRotation = 0;
        this.upgradeCostElements = []; // Stores elements for later updates 
        this.selectedUpgradeTab = 0;
        this.upgradePanelOpen = false;
        this.upgradeBulkMode = false;
        this.inactivityTimerInterval = null;
        this.inactivityTimeout = 540; // Warning starts after 1 minute; 9 minutes remain until 10-minute kick.
        this.x1PromptElement = null;
        this.x1SendPromptElement = null;
        this.enemyCoreActionsElement = null;
        this.relocatePromptElement = null;
        this.baseLayoutDialogElement = null;
        this.baseLayoutDialogCleanup = null;
        this.profilePanelElement = null;
        this.prePlaySkinPromptElement = null;
        this.discordJoinPromptElement = null;
        this.x1StatusElement = null;
        this.x1StatusInterval = null;
        this.x1PromptTimeout = null;
        this.x1SendPromptTimeout = null;
        this._pinAutoBuildMenuOpen = false;
        this._lastGlobalRankLoginState = null;
        this.hudConfig = this.getDefaultHudConfig();
        this.hudCustomizeMode = false;
        this.hudCustomizeBindings = [];
        this.hudSyncTimeout = null;
        this.hudEditSessionOverlay = null;
        this.hudEditSessionState = null;
        this.hudEditPreviewState = null;
        this.hudLayoutDirty = false;
        this.keybindEditorOverlay = null;
        this.unitStyleEditorOverlay = null;
        this._autoBuildShowActions = null;
        this._autoBuildShowMenu = null;
        this._startupRandomSkinApplied = false;
        this.hideMenuSecondaryPanels = false;
        this.discordOnboardingInProgress = false;
        this.soldierSelectionCounterElement = null;
        this._globalLeaderboardRefreshTimer = null;
        this.musicControlsElement = null;
        this.musicControlsTrackLabel = null;
        this.musicControlsVolumeLabel = null;
        this.musicControlsPlayPauseButton = null;
        this.musicControlsMuteButton = null;
        this._musicControlsResizeHandler = null;
        this.screenNoticeElement = null;
        this.screenNoticeHideTimeout = null;
        this._baseLayoutHotkeyLoadInFlight = false;
        this._cameraZoomInitialized = false;
        this.tutorialPendingStart = false;
        this.tutorialModeActive = false;
        this.tutorialPollTimer = null;
        this.tutorialStartedAt = 0;
        this.tutorialInitialCameraState = null;
        this.tutorialBaselineCounts = null;
        this.tutorialOverlay = null;
        this.tutorialSteps = [];
        this.tutorialIndex = 0;
        this.tutorialFocusRing = null;
        this.tutorialStepPointer = null;
        this.tutorialCurrentTarget = null;
        this.tutorialLastStepKey = "";
        this.tutorialStepCompletion = {};
        this.tutorialActionMarks = {};
        
        // Skin navigation properties
        this.currentSkinIndex = 0;
        this.availableSkins = [];
        this.skinPersistTimeout = null;

        this.initializeUIElements();
        this.applyPlatformRestrictions();
        this.ensureSoldierSelectionCounter();
        this.embedPlayControlsIntoAccountCard();
        this.loadHudConfig();
        this.initializeSkinsFromCache(); // First: load from localStorage cache
        this.loadSupabaseSkins(); // Then: fetch fresh from Supabase (updates cache)
        this.addLoginDialogButtonListener();
        this.addPlayButtonListener();
        this.addContinueButtonListener();
        this.addMenuDialogButtonListener();
        this.addTutorialButtonListener();
        this.addSkinNavigationListeners(); // New: skin navigation
        this.addSkinUseButtonListener(); // New: Use button
        this.addSkinCircleClickListener(); // New: click on circle to open library
        this.addSkinLibraryButtonListener();
        this.addMenuShortcutLinks();
        this.addLegalDialogListeners();
        this.addSettingsPanelListener();
        this.initializeCustomizationSettingsUI();
        this.addChatButtonElementListener();
        this.addUnitControlsListener();
        this.addAutoBuildMenuButtons();
        this.addMusicControls();
        this.placeGroupTroopsBesidePower();
        this.applyHudConfig();
        this.loadHudConfigFromAccount();
        this.setupLanguageSelector();
        this.applyLanguage({ refreshLeaderboard: true });
        this.startGlobalLeaderboardAutoRefresh();
        this.maybeShowOAuthError();
        this.maybeHandlePendingSocialOnboarding();
    }

    startGlobalLeaderboardAutoRefresh () {
        if (this._globalLeaderboardRefreshTimer) {
            clearInterval(this._globalLeaderboardRefreshTimer);
        }

        this._globalLeaderboardRefreshTimer = setInterval(() => {
            if (this.core?.gameManager?.player) return;
            if (!document.getElementById("global-leaderboard")) return;
            this._populateGlobalLeaderboard();
        }, 15000);
    }

    t (key, vars = {}) {
        return this.languageManager.t(key, vars);
    }

    tutorialText (pt, en, es) {
        const lang = this.languageManager?.getLanguage?.() || "en";
        if (lang === "pt") return pt;
        if (lang === "es") return es;
        return en;
    }

    isLogoutLikeLabel (value = "") {
        const normalize = (text = "") => String(text || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "");
        const normalized = normalize(value);
        const logoutLocalized = normalize(this.t("menu.logout"));
        return normalized === "logout"
            || normalized === "log out"
            || normalized === "sign out"
            || normalized === "sair"
            || normalized === "sair da conta"
            || normalized === "cerrar sesion"
            || normalized === "encerrar sessao"
            || normalized === logoutLocalized;
    }

    isExternalAuthDisabled () {
        return Boolean(this.core?.platform?.shouldDisableExternalAuth?.());
    }

    applyPlatformRestrictions () {
        if (!this.isExternalAuthDisabled()) return;

        const hide = (element) => {
            if (!element) return;
            element.style.display = "none";
            element.setAttribute("aria-hidden", "true");
        };

        hide(this.DOM?.account?.accountButton);
        hide(this.DOM?.account?.signupButton);
        hide(this.DOM?.account?.loginDialog);
        hide(this.DOM?.account?.signupDialog);
        hide(this.DOM?.account?.signinDialog);

        const accountButtons = document.querySelector(".account-buttons");
        if (accountButtons) {
            accountButtons.style.display = "none";
            accountButtons.setAttribute("aria-hidden", "true");
        }
    }

    ensureSoldierSelectionCounter () {
        if (this.soldierSelectionCounterElement?.isConnected) return;

        const gameContainer = this.DOM?.game?.container || document.getElementById("game-container");
        if (!gameContainer) return;

        let counter = document.getElementById("soldier-selection-counter");
        if (!counter) {
            counter = document.createElement("div");
            counter.id = "soldier-selection-counter";
            counter.style.display = "none";

            const label = document.createElement("span");
            label.className = "soldier-counter-label";

            const value = document.createElement("span");
            value.className = "soldier-counter-value";

            const description = document.createElement("div");
            description.className = "soldier-counter-description";
            description.style.display = "none";

            counter.appendChild(label);
            counter.appendChild(value);
            counter.appendChild(description);
            gameContainer.appendChild(counter);
        }

        this.soldierSelectionCounterElement = counter;
    }

    updateSoldierSelectionCounter (selectedCount = 0, totalCount = 0, options = {}) {
        this.ensureSoldierSelectionCounter();
        const counter = this.soldierSelectionCounterElement;
        if (!counter) return;

        const hasCustomValue = typeof options?.valueText === "string" && options.valueText.length > 0;
        if (!hasCustomValue && totalCount <= 0) {
            counter.style.display = "none";
            return;
        }

        const labelText = options?.labelText || "Soldiers";
        const valueText = hasCustomValue ? options.valueText : `${selectedCount}/${totalCount}`;
        const descriptionText = options?.descriptionText || "";
        const label = counter.querySelector(".soldier-counter-label");
        const value = counter.querySelector(".soldier-counter-value");
        const description = counter.querySelector(".soldier-counter-description");

        if (label) label.textContent = labelText;
        if (value) value.textContent = valueText;
        if (description) {
            if (descriptionText) {
                description.textContent = descriptionText;
                description.style.display = "block";
            } else {
                description.textContent = "";
                description.style.display = "none";
            }
        }

        counter.style.display = "flex";
    }

    setupLanguageSelector () {
        const select = document.getElementById("language-select");
        if (!select || select.dataset.boundLanguageSelect) return;
        select.dataset.boundLanguageSelect = "1";
        select.value = this.languageManager.getLanguage();
        select.addEventListener("change", () => {
            this.languageManager.setLanguage(select.value);
            this.applyLanguage({ refreshLeaderboard: true });
        });
    }

    applyLanguage ({ refreshLeaderboard = false } = {}) {
        const setText = (selector, key) => {
            const el = document.querySelector(selector);
            if (el) el.textContent = this.t(key);
        };
        const setPlaceholder = (selector, key) => {
            const el = document.querySelector(selector);
            if (el) el.placeholder = this.t(key);
        };

        document.documentElement.lang = this.languageManager.getLanguage();
        const lang = this.languageManager.getLanguage();
        const changelogButtonLabel = lang === "pt"
            ? "Atualizacoes"
            : (lang === "es" ? "Actualizaciones" : "Changelog");
        const changelogSubtitle = lang === "pt"
            ? "Ultimas atualizacoes e correcoes"
            : (lang === "es" ? "Ultimas actualizaciones y correcciones" : "Latest updates and fixes");

        setText("#language-label", "language.label");
        const languageSelect = document.getElementById("language-select");
        if (languageSelect) {
            languageSelect.setAttribute("aria-label", this.t("language.label"));
            const en = languageSelect.querySelector('option[value="en"]');
            const pt = languageSelect.querySelector('option[value="pt"]');
            const es = languageSelect.querySelector('option[value="es"]');
            if (en) en.textContent = this.t("language.english");
            if (pt) pt.textContent = this.t("language.portuguese");
            if (es) es.textContent = this.t("language.spanish");
        }

        setText("#play-button", "menu.play");
        const tutorialLabel = this.languageManager.getLanguage() === "pt" ? "Tutorial" : (this.languageManager.getLanguage() === "es" ? "Tutorial" : "Tutorial");
        const tutorialButton = document.getElementById("tutorial-button");
        if (tutorialButton) tutorialButton.textContent = tutorialLabel;
        setPlaceholder("#player-name", "menu.playerName");
        setText("#account-button", this.core?.networkManager?.loggedIn ? "menu.logout" : "menu.login");
        setText("#signup-button", "menu.signUp");
        setText("#discord-button", "menu.discord");
        setText("#discord-open-button", "menu.discord");
        setText("#shop-button", "menu.shop");
        setText("#skin-name-display", "menu.default");
        setText("#skin-use-button", "menu.use");
        setText("#skin-library-dialog h1", "menu.yourSkins");
        setText("#privacy-open-button", "legal.privacyPolicy");
        setText("#terms-open-button", "legal.termsOfUse");
        setText("#about-open-button", "legal.about");
        const changelogOpenButton = document.querySelector("#changelog-open-button");
        if (changelogOpenButton) changelogOpenButton.textContent = changelogButtonLabel;

        setText("#menu-dialog h2", "menu.connectionRejected");
        const rejected = document.querySelectorAll("#menu-dialog p");
        if (rejected[0]) rejected[0].textContent = this.t("menu.connectionDesc1");
        if (rejected[1]) rejected[1].textContent = this.t("menu.connectionDesc2");
        if (rejected[2]) rejected[2].textContent = this.t("menu.connectionDesc3");
        if (rejected[3]) rejected[3].textContent = this.t("menu.connectionTryAgain");
        setText("#menu-dialog-button", "menu.okay");

        setText("#login-dialog h2", "dialog.accessFeatures");
        const loginIntro = document.querySelector("#login-dialog .menu-card > p");
        if (loginIntro) {
            loginIntro.innerHTML = `${this.t("dialog.loginReserved")}<br><strong>${this.t("dialog.loginPerks")}</strong>`;
        }
        const benefitItems = document.querySelectorAll("#login-dialog .login-benefits li");
        if (benefitItems[0]) benefitItems[0].textContent = this.t("dialog.benefit1");
        if (benefitItems[1]) benefitItems[1].textContent = this.t("dialog.benefit2");
        if (benefitItems[2]) benefitItems[2].textContent = this.t("dialog.benefit3");
        if (benefitItems[3]) benefitItems[3].textContent = this.t("dialog.benefit4");
        if (benefitItems[4]) benefitItems[4].textContent = this.t("dialog.benefit5");
        setText("#guest-button", "dialog.continueGuest");
        setText("#signup-dialog h2", "dialog.createAccount");
        setText("#signup-dialog p", "dialog.createAccountDesc");
        setPlaceholder("#signup-email", "dialog.email");
        setPlaceholder("#signup-nickname", "dialog.nickname");
        setPlaceholder("#signup-password", "dialog.password");
        const defaultDiscordLabel = lang === "pt" ? "Cadastrar com Discord" : (lang === "es" ? "Registrarse con Discord" : "Sign up with Discord");
        const defaultSigninDiscordLabel = lang === "pt" ? "Entrar com Discord" : (lang === "es" ? "Iniciar con Discord" : "Continue with Discord");
        const discordLabel = this.t("dialog.signUpDiscord");
        const signinDiscordLabel = this.t("dialog.signInDiscord");
        const discordBtn = document.querySelector("#signup-discord");
        const signinDiscordBtn = document.querySelector("#signin-discord");
        if (discordBtn) discordBtn.textContent = (!discordLabel || discordLabel === "dialog.signUpDiscord") ? defaultDiscordLabel : discordLabel;
        if (signinDiscordBtn) signinDiscordBtn.textContent = (!signinDiscordLabel || signinDiscordLabel === "dialog.signInDiscord") ? defaultSigninDiscordLabel : signinDiscordLabel;
        setText("#signup-submit", "dialog.createAccountBtn");
        setText("#signup-cancel", "dialog.cancel");
        setText("#signin-dialog h2", "dialog.loginTitle");
        setText("#signin-dialog p", "dialog.loginDesc");
        setPlaceholder("#signin-email", "dialog.email");
        setPlaceholder("#signin-password", "dialog.password");
        setText("#signin-submit", "menu.login");
        setText("#signin-cancel", "dialog.cancel");

        setText("#privacy-dialog h2", "legal.privacyPolicy");
        setText("#terms-dialog h2", "legal.termsOfUse");
        setText("#about-dialog h2", "legal.about");
        const changelogDialogTitle = document.querySelector("#changelog-dialog h2");
        if (changelogDialogTitle) changelogDialogTitle.textContent = changelogButtonLabel;
        document.querySelectorAll(".privacy-updated").forEach((el) => {
            if (el.closest("#about-dialog")) {
                el.textContent = this.t("legal.aboutTagline");
            } else if (el.closest("#changelog-dialog")) {
                el.textContent = changelogSubtitle;
            } else {
                el.textContent = this.t("legal.lastUpdated");
            }
        });
        this.renderLocalizedChangelog();

        setText("#game-over-content h1 span:first-child", "game.killedBy");
        const scoreStrong = document.querySelector("#game-over-stats p:nth-child(1) strong");
        const timeStrong = document.querySelector("#game-over-stats p:nth-child(2) strong");
        if (scoreStrong) scoreStrong.textContent = `${this.t("menu.score")}:`;
        if (timeStrong) timeStrong.textContent = `${this.t("game.time")}:`;
        setText("#continue-button", "game.continue");
        setText("#inactivity-warning-container h1", "game.areYouThere");
        setText("#inactivity-warning-container p:nth-child(2)", "game.inactiveKick");
        setText("#game-settings .slider button", "game.settings");
        setText("#game-settings .theme-settings p", "game.theme");
        const removeGridLabel = document.querySelector('label[for="remove-grid-checkbox"]');
        if (removeGridLabel) {
            removeGridLabel.childNodes.forEach((node) => {
                if (node.nodeType === 3) node.textContent = ` ${this.t("game.disableGrid")}`;
            });
        }
        setText("#destroy-button p:first-child", "game.destroy");
        setText("#chat .header h3", "game.chatTitle");
        setText("#chat-messages .message .text", "game.chatWelcome");
        setPlaceholder("#chat-message-input", "game.message");
        setText("#chat-button", "game.send");
        this.syncGroupTroopsState(Boolean(this.groupUnitsActive), false);
        setText("#top-menu-pulltab", "game.menu");
        const topThemeBtn = document.getElementById("top-theme-btn");
        if (topThemeBtn) topThemeBtn.textContent = this.t("game.theme").replace(":", "");
        const topDiscordBtn = document.getElementById("top-discord-btn");
        if (topDiscordBtn) topDiscordBtn.textContent = this.t("menu.discord");
        const statsLabels = document.querySelectorAll("#stats-container > div > p:first-child");
        if (statsLabels[0]) statsLabels[0].textContent = `${this.t("stats.highscore")}:`;
        if (statsLabels[1]) statsLabels[1].textContent = `${this.t("stats.playtime")}:`;
        if (statsLabels[2]) statsLabels[2].textContent = `${this.t("stats.totalKills")}:`;

        if (this.unitStyleEditorOverlay) this.showUnitStyleEditor(true);
        if (this.keybindEditorOverlay) this.showKeybindEditor(true);
        if (this.hudEditSessionOverlay) {
            setText("#hud-edit-session-overlay .hud-edit-session-help", "hud.editHelp");
            setText("#hud-edit-session-overlay .hud-edit-btn.models", "hud.models");
            setText("#hud-edit-session-overlay .hud-edit-btn.keys", "hud.keybinds");
            setText("#hud-edit-session-overlay .hud-edit-btn.save", "hud.save");
            setText("#hud-edit-session-overlay .hud-edit-btn.reset", "hud.factoryDefaults");
            setText("#hud-edit-session-overlay .hud-edit-btn.close", "hud.exit");
        }

        this.updateAccountButton();
        if (refreshLeaderboard) this._populateGlobalLeaderboard();
    }

    getDefaultHudConfig () {
        return {
            version: 1,
            hud: {
                chat: { x: null, y: null, width: null, height: null },
                leaderboard: { x: null, y: null, width: null, height: null },
                globalRank: { x: null, y: null, width: null, height: null },
                resources: { x: null, y: null, width: null, height: null },
                protection: { x: null, y: null, width: null, height: null },
                toolbar: { x: null, y: null, width: null, height: null },
                upgrades: { x: null, y: null, width: null, height: null }
            },
            keybinds: {
                selectArmy: "q",
                selectCommander: "c",
                setCommanderDefenseRadius: "h",
                selectAllUnits: "e",
                toggleMap: "m",
                returnToBase: "r",
                toggleGroupTroops: "z",
                toggleHudMiniMap: "",
                toggleHudChat: "",
                toggleHudLeaderboard: "",
                toggleHudToolbar: "",
                toggleHudGroupTroopsPanel: "",
                selectSoldiersOnly: "x",
                selectTanksOnly: "v",
                selectSiegeOnly: "b",
                selectCommanderSoldiers: "",
                selectCommanderTanks: "",
                selectCommanderSiege: "",
                selectCommanderSoldiersTanks: "",
                selectCommanderSoldiersSiege: "",
                selectCommanderTanksSiege: "",
                selectCommanderArmy: "",
                upgrade1: "q",
                upgrade2: "e",
                upgrade3: "t",
                upgradeDestroy: "r",
                upgradeBarracksToggle: "f",
                upgradeAllMode: "y",
                upgradeDestroyAll: "u"
            },
            upgradeHotkeys: {},
            cameraControls: {
                speed: 3,
                zoom: 1.5
            },
            unitShapes: {
                soldier: "triangle",
                tank: "triangle",
                siege: "triangle"
            },
            unitStyles: {
                soldierModel: "model1",
                tankModel: "model1",
                siegeModel: "model1"
            },
            hudVisibility: {
                miniMap: true,
                toolbar: true,
                groupTroops: true
            },
            collapsedPanels: {
                chat: false,
                leaderboard: false,
                toolbar: false,
                groupTroops: false
            }
        };
    }

    mergeHudConfig (incoming = {}) {
        const defaults = this.getDefaultHudConfig();
        const hud = incoming?.hud || {};
        return {
            ...defaults,
            ...incoming,
            hud: {
                ...defaults.hud,
                ...hud,
                chat: { ...defaults.hud.chat, ...(hud.chat || {}) },
                leaderboard: { ...defaults.hud.leaderboard, ...(hud.leaderboard || {}) },
                globalRank: { ...defaults.hud.globalRank, ...(hud.globalRank || {}) },
                resources: { ...defaults.hud.resources, ...(hud.resources || {}) },
                protection: { ...defaults.hud.protection, ...(hud.protection || {}) },
                toolbar: { ...defaults.hud.toolbar, ...(hud.toolbar || {}) },
                upgrades: { ...defaults.hud.upgrades, ...(hud.upgrades || {}) }
            },
            keybinds: {
                ...defaults.keybinds,
                ...(incoming?.keybinds || {})
            },
            upgradeHotkeys: (incoming?.upgradeHotkeys && typeof incoming.upgradeHotkeys === "object")
                ? { ...incoming.upgradeHotkeys }
                : {},
            cameraControls: {
                ...defaults.cameraControls,
                ...((incoming?.cameraControls && typeof incoming.cameraControls === "object") ? incoming.cameraControls : {})
            },
            unitShapes: {
                ...defaults.unitShapes,
                ...(incoming?.unitShapes || {})
            },
            unitStyles: {
                ...defaults.unitStyles,
                ...(incoming?.unitStyles || {})
            },
            hudVisibility: {
                ...defaults.hudVisibility,
                ...((incoming?.hudVisibility && typeof incoming.hudVisibility === "object") ? incoming.hudVisibility : {})
            },
            collapsedPanels: {
                ...defaults.collapsedPanels,
                ...(incoming?.collapsedPanels || {})
            }
        };
    }

    loadHudConfig () {
        try {
            const raw = localStorage.getItem("warhex_hud_config");
            if (!raw) {
                this.hudConfig = this.getDefaultHudConfig();
                return;
            }
            this.hudConfig = this.mergeHudConfig(JSON.parse(raw));
        } catch (error) {
            console.warn("Failed to load HUD config:", error);
            this.hudConfig = this.getDefaultHudConfig();
        }
    }

    saveHudConfigLocal () {
        try {
            localStorage.setItem("warhex_hud_config", JSON.stringify(this.hudConfig));
        } catch (error) {
            console.warn("Failed to save HUD config locally:", error);
        }
    }

    scheduleHudConfigSync () {
        this.saveHudConfigLocal();
        if (this.hudSyncTimeout) clearTimeout(this.hudSyncTimeout);
        this.hudSyncTimeout = setTimeout(() => this.saveHudConfigRemote(), 500);
    }

    isAccountHudSyncReady () {
        const networkManager = this.core?.networkManager;
        const loggedIn = Boolean(networkManager?.loggedIn);
        const userId = String(networkManager?.userId || "").trim();
        const looksLikeAuthUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
        return loggedIn && looksLikeAuthUuid;
    }

    async loadHudConfigFromAccount () {
        try {
            if (!this.isAccountHudSyncReady()) return;
            const userId = this.core?.networkManager?.userId;
            if (!userId) return;
            const result = await fetchUserHudSettings(userId);
            if (result?.success && result.data) {
                this.hudConfig = this.mergeHudConfig(result.data);
                this.saveHudConfigLocal();
                this.applyHudConfig();
                this.applyCameraControlsFromHudConfig({ applyZoom: true });
                this.refreshCustomizationSettingsUI();
            }
        } catch (error) {
            console.warn("Failed to load HUD config from account:", error);
        }
    }

    async saveHudConfigRemote () {
        try {
            if (!this.isAccountHudSyncReady()) return;
            const userId = this.core?.networkManager?.userId;
            if (!userId) return;
            await upsertUserHudSettings(userId, this.hudConfig);
        } catch (error) {
            console.warn("Failed to save HUD config to account:", error);
        }
    }

    normalizeKeybindValue (keyValue) {
        if (keyValue === null || keyValue === undefined) return "";
        const raw = String(keyValue);
        if (raw === " ") return "space";
        const normalized = raw.trim().toLowerCase();
        if (!normalized) return "";

        const aliases = {
            ctrl: "control",
            ctl: "control",
            esc: "escape",
            del: "delete",
            ins: "insert",
            return: "enter",
            spacebar: "space",
            left: "arrowleft",
            right: "arrowright",
            up: "arrowup",
            down: "arrowdown",
            cmd: "meta",
            win: "meta",
            windows: "meta",
            option: "alt",
            pgup: "pageup",
            pgdn: "pagedown",
            xbutton1: "mouse4",
            xbutton2: "mouse5",
            mouseleft: "mouse1",
            mouseright: "mouse3",
            mousemiddle: "mouse2",
            mousebutton1: "mouse1",
            mousebutton2: "mouse2",
            mousebutton3: "mouse3",
            mousebutton4: "mouse4",
            mousebutton5: "mouse5",
            multiply: "*",
            numpadmultiply: "*",
            asterisk: "*",
            star: "*"
        };

        return aliases[normalized] || normalized;
    }

    isReservedGameplayKeybind (keyValue) {
        const normalized = this.normalizeKeybindValue(keyValue);
        return normalized === "delete";
    }

    getReservedGameplayKeybindNotice (keyValue) {
        const normalized = this.normalizeKeybindValue(keyValue);
        if (normalized === "delete") {
            return "Key DELETE is reserved for Sell/Destroy. Choose another key.";
        }
        return "";
    }

    formatKeybindLabel (keyValue) {
        const normalized = this.normalizeKeybindValue(keyValue);
        if (!normalized) return this.t("hud.none");
        if (/^mouse\d+$/.test(normalized)) {
            return `MOUSE ${normalized.slice(5)}`;
        }
        const displayAliases = {
            control: "CTRL",
            meta: "META",
            alt: "ALT",
            shift: "SHIFT",
            enter: "ENTER",
            tab: "TAB",
            escape: "ESC",
            backspace: "BACKSPACE",
            delete: "DELETE",
            insert: "INSERT",
            home: "HOME",
            end: "END",
            pageup: "PAGE UP",
            pagedown: "PAGE DOWN",
            arrowup: "ARROW UP",
            arrowdown: "ARROW DOWN",
            arrowleft: "ARROW LEFT",
            arrowright: "ARROW RIGHT",
            space: "SPACE"
        };
        return displayAliases[normalized] || normalized.toUpperCase();
    }

    getHudKeybind (actionName, fallbackKey) {
        const all = this.hudConfig?.keybinds || {};
        if (Object.prototype.hasOwnProperty.call(all, actionName)) {
            return this.normalizeKeybindValue(all[actionName]);
        }
        return this.normalizeKeybindValue(fallbackKey);
    }

    formatEnumLabel (rawValue) {
        return String(rawValue || "")
            .toLowerCase()
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    getBuildingTypeLabel (buildingType) {
        const safeType = Number(buildingType);
        const buildingKey = Object.keys(BuildingTypes).find((key) => Number(BuildingTypes[key]) === safeType);
        return this.formatEnumLabel(buildingKey || `Type ${safeType}`);
    }

    getReachableBuildingUpgradeVariants (buildingType) {
        const safeType = Number(buildingType);
        if (!Number.isFinite(safeType)) return [];

        const visited = new Set();
        const queue = [];
        const out = [];
        const baseDetails = getBuildingDetails(safeType, 0);
        const initialNext = Array.isArray(baseDetails?.next) ? baseDetails.next : [];
        initialNext.forEach((variant) => queue.push(Number(variant)));

        while (queue.length > 0) {
            const variant = Number(queue.shift());
            if (!Number.isFinite(variant) || variant <= 0 || visited.has(variant)) continue;
            visited.add(variant);

            const details = getBuildingDetails(safeType, variant);
            if (!details || Number(details?.variant) !== variant) continue;
            out.push(variant);

            const nextList = Array.isArray(details?.next) ? details.next : [];
            nextList.forEach((nextVariant) => {
                const numeric = Number(nextVariant);
                if (!Number.isFinite(numeric) || numeric <= 0 || visited.has(numeric)) return;
                queue.push(numeric);
            });
        }

        return out.sort((a, b) => a - b);
    }

    getUpgradeHotkeyDefinitions () {
        const defs = [];
        const known = new Set();
        const addDef = (id, label, section) => {
            const safeId = String(id || "");
            if (!safeId || known.has(safeId)) return;
            known.add(safeId);
            defs.push({
                id: safeId,
                label: String(label || safeId),
                section: String(section || "Other")
            });
        };

        const visibleArmoryVariants = new Set([
            Number(BuildingVariantTypes?.ARMORY?.POWER_ARMOR),
            Number(BuildingVariantTypes?.ARMORY?.BOOSTER_ENGINES),
            Number(BuildingVariantTypes?.ARMORY?.PANZER_CANNONS),
            Number(BuildingVariantTypes?.ARMORY?.CLOAKING_DEVICE)
        ].filter((value) => Number.isFinite(value) && value > 0));

        Object.keys(BuildingTypes).forEach((buildingKey) => {
            const buildingType = Number(BuildingTypes[buildingKey]);
            if (!Number.isFinite(buildingType)) return;
            if (buildingType === BuildingTypes.PORTAL) return;

            const typeLabel = this.formatEnumLabel(buildingKey);
            addDef(`sell-type:${buildingType}`, `Sell All ${typeLabel}`, `${typeLabel} Sell`);

            const upgradeVariants = (buildingType === BuildingTypes.ARMORY)
                ? Array.from(visibleArmoryVariants).sort((a, b) => a - b)
                : this.getReachableBuildingUpgradeVariants(buildingType);

            upgradeVariants.forEach((variant) => {
                const details = getBuildingDetails(buildingType, variant);
                if (!details) return;
                const upgradeName = String(details?.name || `Variant ${variant}`);
                const upgradeId = (buildingType === BuildingTypes.ARMORY)
                    ? `armory:${variant}`
                    : `building:${buildingType}:${variant}`;

                addDef(upgradeId, `${typeLabel}: ${upgradeName}`, `${typeLabel} Upgrades`);
                addDef(
                    `sell-variant:${buildingType}:${variant}`,
                    `${typeLabel}: Sell ${upgradeName}`,
                    `${typeLabel} Sell`
                );
            });
        });

        return defs.sort((a, b) => {
            const sectionCompare = String(a.section).localeCompare(String(b.section));
            if (sectionCompare !== 0) return sectionCompare;
            return String(a.label).localeCompare(String(b.label));
        });
    }

    getUpgradeHotkeyDefinitionById (upgradeId) {
        const normalizedId = String(upgradeId || "");
        if (!normalizedId) return null;
        const defs = this.getUpgradeHotkeyDefinitions();
        return defs.find((entry) => entry.id === normalizedId) || null;
    }

    getUpgradeHotkeyLabel (upgradeId) {
        const found = this.getUpgradeHotkeyDefinitionById(upgradeId);
        if (found?.label) return found.label;
        return `Upgrade ${String(upgradeId || "").trim() || "Hotkey"}`;
    }

    getUpgradeHotkeyValue (upgradeId) {
        const id = String(upgradeId || "");
        if (!id) return "";
        const hotkeys = (this.hudConfig?.upgradeHotkeys && typeof this.hudConfig.upgradeHotkeys === "object")
            ? this.hudConfig.upgradeHotkeys
            : {};
        return this.normalizeKeybindValue(hotkeys[id] || "");
    }

    setUpgradeHotkeyValue (upgradeId, keyValue, options = {}) {
        const id = String(upgradeId || "");
        if (!id) return { ok: false };
        const normalized = this.normalizeKeybindValue(keyValue);
        if (!this.hudConfig.upgradeHotkeys || typeof this.hudConfig.upgradeHotkeys !== "object") {
            this.hudConfig.upgradeHotkeys = {};
        }

        if (normalized === "unidentified" || normalized === "process") {
            this.refreshKeybindEditorUI();
            return { ok: false };
        }

        if (!normalized) {
            delete this.hudConfig.upgradeHotkeys[id];
            this.scheduleHudConfigSync();
            this.refreshCustomizationSettingsUI();
            this.refreshKeybindEditorUI();
            return { ok: true };
        }

        if (this.isReservedGameplayKeybind(normalized)) {
            if (options?.warnOnConflict !== false) {
                this.notifySystemWarning(this.getReservedGameplayKeybindNotice(normalized));
            }
            this.refreshCustomizationSettingsUI();
            this.refreshKeybindEditorUI();
            return { ok: false, reserved: true };
        }

        const conflict = this.findConfiguredKeyConflict(normalized, {
            excludeScope: "upgrade-item",
            excludeId: id
        });
        if (conflict && options?.warnOnConflict !== false) {
            this.showKeyConflictNotice(normalized, conflict, { assigned: true });
        }

        this.hudConfig.upgradeHotkeys[id] = normalized;
        this.scheduleHudConfigSync();
        this.refreshCustomizationSettingsUI();
        this.refreshKeybindEditorUI();
        return { ok: true, conflict: conflict || null };
    }

    getUpgradeHotkeyIdForItem (buildingType, upgradeInfo, options = {}) {
        const variant = Number(upgradeInfo?.variant);
        if (!Number.isFinite(variant)) return "";

        const isArmory = Boolean(options?.isArmory);
        if (isArmory) {
            return `armory:${variant}`;
        }

        const safeBuildingType = Number(buildingType);
        if (!Number.isFinite(safeBuildingType)) return "";
        return `building:${safeBuildingType}:${variant}`;
    }

    getUpgradeHotkeyBindingForItem (buildingType, upgradeInfo, options = {}) {
        const upgradeId = this.getUpgradeHotkeyIdForItem(buildingType, upgradeInfo, options);
        const configured = this.getUpgradeHotkeyValue(upgradeId);
        if (configured) {
            return {
                upgradeId,
                key: configured,
                label: this.formatKeybindLabel(configured)
            };
        }

        const index = Number(options?.index);
        const fallbackActions = ["upgrade1", "upgrade2", "upgrade3"];
        const fallbackKeyByAction = { upgrade1: "q", upgrade2: "e", upgrade3: "t" };
        const fallbackAction = Number.isFinite(index) ? (fallbackActions[index] || "") : "";
        const fallbackValue = fallbackAction
            ? this.getHudKeybind(fallbackAction, fallbackKeyByAction[fallbackAction] || "")
            : "";

        return {
            upgradeId,
            key: "",
            label: fallbackValue ? this.formatKeybindLabel(fallbackValue) : "-"
        };
    }

    stopPreviewAnimationsIn (containerElement) {
        if (!containerElement || !containerElement.querySelectorAll) return;
        const canvases = containerElement.querySelectorAll("canvas");
        canvases.forEach((canvas) => {
            if (typeof canvas?.stopAnimation === "function") {
                canvas.stopAnimation();
            }
        });
    }

    appendUpgradeHotkeyPreview (rowElement, def, options = {}) {
        if (!rowElement || !def?.id) return;
        const size = Math.max(24, Number(options?.size) || 40);
        const preview = document.createElement("canvas");
        preview.className = "hud-upgrade-hotkey-preview";
        preview.width = size;
        preview.height = size;

        const rawId = String(def.id || "");
        const armoryMatch = /^armory:(\d+)$/.exec(rawId);
        const buildingVariantMatch = /^(?:building|sell-variant):(\d+):(\d+)$/.exec(rawId);
        const sellTypeMatch = /^sell-type:(\d+)$/.exec(rawId);

        const previewColor = this.core?.gameManager?.player?.color || "#6dd7ff";
        const resolveScale = (renderable, fallback = 0.46) => {
            const canvasSize = Math.max(1, Math.min(preview.width, preview.height));
            const detailSize = Number(renderable?.details?.size);
            const rawSize = Number.isFinite(detailSize) && detailSize > 0
                ? detailSize
                : Number(renderable?.size);
            if (!Number.isFinite(rawSize) || rawSize <= 0) return fallback;
            // detail size behaves as a radius for most entities; fit full diameter in the preview box.
            const diameter = rawSize * 2;
            const maxDrawable = canvasSize * 0.78;
            const fitScale = maxDrawable / diameter;
            return Math.max(0.08, Math.min(fallback, fitScale));
        };
        try {
            if (armoryMatch) {
                const armoryVariant = Number(armoryMatch[1]);
                const details = getBuildingDetails(BuildingTypes.ARMORY, armoryVariant);
                const unitType = Number(details?.unitType);
                const unitVariant = Number(details?.unitVariant);
                if (Number.isFinite(unitType) && Number.isFinite(unitVariant)) {
                    const UnitClass = UnitManager.getUnitClassByType(unitType);
                    if (UnitClass) {
                        const renderable = new UnitClass(previewColor, { x: 0, y: 0 }, unitVariant);
                        this.animatePreview(preview, renderable, {
                            scale: resolveScale(renderable, 0.46),
                            rotationSpeed: 0
                        });
                    }
                }
            } else if (buildingVariantMatch) {
                const buildingType = Number(buildingVariantMatch[1]);
                const buildingVariant = Number(buildingVariantMatch[2]);
                const BuildingClass = BuildingManager.getBuildingClassByType(buildingType);
                if (BuildingClass) {
                    const renderable = new BuildingClass(previewColor, { x: 0, y: 0 }, buildingVariant);
                    this.animatePreview(preview, renderable, {
                        scale: resolveScale(renderable, 0.46),
                        rotationSpeed: 0
                    });
                }
            } else if (sellTypeMatch) {
                const buildingType = Number(sellTypeMatch[1]);
                const BuildingClass = BuildingManager.getBuildingClassByType(buildingType);
                if (BuildingClass) {
                    const renderable = new BuildingClass(previewColor, { x: 0, y: 0 }, 0);
                    this.animatePreview(preview, renderable, {
                        scale: resolveScale(renderable, 0.46),
                        rotationSpeed: 0
                    });
                }
            }
        } catch (error) {}
        rowElement.appendChild(preview);
    }

    findUpgradeHotkeyActionIdByKey (keyValue) {
        const key = this.normalizeKeybindValue(keyValue);
        if (!key) return "";
        const hotkeys = (this.hudConfig?.upgradeHotkeys && typeof this.hudConfig.upgradeHotkeys === "object")
            ? this.hudConfig.upgradeHotkeys
            : {};
        const validIds = new Set(this.getUpgradeHotkeyDefinitions().map((entry) => String(entry?.id || "")));
        const matchingIds = Object.keys(hotkeys).filter((upgradeId) => {
            if (!validIds.has(String(upgradeId || ""))) return false;
            return this.normalizeKeybindValue(hotkeys[upgradeId]) === key;
        });
        if (matchingIds.length <= 1) return matchingIds[0] || "";
        this.notifySystemWarning(`Key ${this.formatKeybindLabel(key)} is mapped to multiple upgrade actions. Keep only one.`);
        return "";
    }

    triggerGlobalUpgradeHotkey (keyValue) {
        const upgradeId = this.findUpgradeHotkeyActionIdByKey(keyValue);
        if (!upgradeId) return false;
        const matchBuilding = /^building:(\d+):(\d+)$/.exec(upgradeId);
        const matchArmory = /^armory:(\d+)$/.exec(upgradeId);
        const matchSellVariant = /^sell-variant:(\d+):(\d+)$/.exec(upgradeId);
        const matchSellType = /^sell-type:(\d+)$/.exec(upgradeId);

        if (matchSellVariant) {
            const buildingType = Number(matchSellVariant[1]);
            const targetVariant = Number(matchSellVariant[2]);
            if (!Number.isFinite(buildingType) || !Number.isFinite(targetVariant)) {
                return true;
            }
            this.core?.buildingManager?.sellAllOwnedBuildings?.(buildingType, {
                variant: targetVariant,
                triggerLabel: this.getUpgradeHotkeyLabel(upgradeId)
            });
            return true;
        }
        if (matchSellType) {
            const buildingType = Number(matchSellType[1]);
            if (!Number.isFinite(buildingType)) {
                return true;
            }
            this.core?.buildingManager?.sellAllOwnedBuildings?.(buildingType, {
                triggerLabel: this.getUpgradeHotkeyLabel(upgradeId)
            });
            return true;
        }

        let buildingType = null;
        let targetVariant = null;
        if (matchBuilding) {
            buildingType = Number(matchBuilding[1]);
            targetVariant = Number(matchBuilding[2]);
        } else if (matchArmory) {
            buildingType = Number(BuildingTypes.ARMORY);
            targetVariant = Number(matchArmory[1]);
        } else {
            return false;
        }
        if (!Number.isFinite(buildingType) || !Number.isFinite(targetVariant)) {
            return true;
        }
        this.core?.buildingManager?.upgradeAllOwnedBuildingsToVariant?.(buildingType, targetVariant, {
            triggerLabel: this.getUpgradeHotkeyLabel(upgradeId)
        });
        return true;
    }

    getCameraControlValue (key, fallback = null) {
        const raw = this.hudConfig?.cameraControls?.[key];
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    setCameraControlValue (key, rawValue, options = {}) {
        if (!this.hudConfig.cameraControls || typeof this.hudConfig.cameraControls !== "object") {
            this.hudConfig.cameraControls = { ...this.getDefaultHudConfig().cameraControls };
        }
        const defaults = this.getDefaultHudConfig().cameraControls;
        let parsed = Number(rawValue);
        if (!Number.isFinite(parsed)) {
            parsed = Number(defaults?.[key]);
        }
        if (!Number.isFinite(parsed)) return;

        if (key === "speed") {
            parsed = Math.max(0.5, Math.min(20, parsed));
            parsed = Math.round(parsed * 10) / 10;
        } else if (key === "zoom") {
            parsed = Math.max(0.05, Math.min(8, parsed));
            parsed = Math.round(parsed * 100) / 100;
        }

        this.hudConfig.cameraControls[key] = parsed;
        this.scheduleHudConfigSync();
        this.applyCameraControlsFromHudConfig({ applyZoom: key === "zoom" || options?.applyZoom === true });
        this.refreshCustomizationSettingsUI();
    }

    applyCameraControlsFromHudConfig (options = {}) {
        const camera = this.core?.camera;
        if (!camera) return;

        const speed = this.getCameraControlValue("speed", 3);
        if (Number.isFinite(speed)) {
            camera.cameraSpeed = Math.max(0.5, Math.min(20, speed));
        }

        if (!options?.applyZoom) return;
        const desiredZoom = this.getCameraControlValue("zoom", camera.zoom);
        if (!Number.isFinite(desiredZoom)) return;
        const minZoom = Number.isFinite(camera.minZoom) ? camera.minZoom : 0.02;
        const maxZoom = Number.isFinite(camera.maxZoom) ? camera.maxZoom : 50;
        const clampedZoom = Math.max(minZoom, Math.min(maxZoom, desiredZoom));
        camera.zoom = clampedZoom;
        camera.targetZoom = clampedZoom;
    }

    getKeybindActionDefinitions () {
        return [
            { key: "selectArmy", label: this.t("key.action.selectArmy"), group: this.t("key.group.selection") },
            { key: "selectSoldiersOnly", label: this.t("key.action.selectSoldiersOnly"), group: this.t("key.group.selection") },
            { key: "selectTanksOnly", label: this.t("key.action.selectTanksOnly"), group: this.t("key.group.selection") },
            { key: "selectSiegeOnly", label: this.t("key.action.selectSiegeOnly"), group: this.t("key.group.selection") },
            { key: "selectCommander", label: this.t("key.action.selectCommander"), group: this.t("key.group.selection") },
            { key: "setCommanderDefenseRadius", label: "Commander Defense Radius", group: this.t("key.group.selection") },
            { key: "selectAllUnits", label: this.t("key.action.selectAllUnits"), group: this.t("key.group.selection") },
            { key: "selectCommanderSoldiers", label: "Commander + Soldiers", group: this.t("key.group.selection") },
            { key: "selectCommanderTanks", label: "Commander + Tanks", group: this.t("key.group.selection") },
            { key: "selectCommanderSiege", label: "Commander + Siege", group: this.t("key.group.selection") },
            { key: "selectCommanderSoldiersTanks", label: "Commander + Soldiers + Tanks", group: this.t("key.group.selection") },
            { key: "selectCommanderSoldiersSiege", label: "Commander + Soldiers + Siege", group: this.t("key.group.selection") },
            { key: "selectCommanderTanksSiege", label: "Commander + Tanks + Siege", group: this.t("key.group.selection") },
            { key: "selectCommanderArmy", label: "Commander + Army", group: this.t("key.group.selection") },
            { key: "toggleMap", label: this.t("key.action.toggleMap"), group: this.t("key.group.hud") },
            { key: "returnToBase", label: this.t("key.action.returnToBase"), group: this.t("key.group.hud") },
            { key: "toggleGroupTroops", label: this.t("key.action.toggleGroupTroops"), group: this.t("key.group.hud") },
            { key: "toggleHudMiniMap", label: "Toggle Minimap", group: this.t("key.group.hud") },
            { key: "toggleHudChat", label: "Minimize Chat", group: this.t("key.group.hud") },
            { key: "toggleHudLeaderboard", label: "Minimize Rank", group: this.t("key.group.hud") },
            { key: "toggleHudToolbar", label: "Toggle Toolbar", group: this.t("key.group.hud") },
            { key: "toggleHudGroupTroopsPanel", label: "Toggle Group Troops", group: this.t("key.group.hud") },
            { key: "upgrade1", label: this.t("key.action.upgrade1"), group: this.t("key.group.upgrades") },
            { key: "upgrade2", label: this.t("key.action.upgrade2"), group: this.t("key.group.upgrades") },
            { key: "upgrade3", label: this.t("key.action.upgrade3"), group: this.t("key.group.upgrades") },
            { key: "upgradeDestroy", label: this.t("key.action.upgradeDestroy"), group: this.t("key.group.upgrades") },
            { key: "upgradeBarracksToggle", label: this.t("key.action.upgradeBarracksToggle"), group: this.t("key.group.upgrades") },
            { key: "upgradeAllMode", label: "Upgrade All Mode", group: this.t("key.group.upgrades") },
            { key: "upgradeDestroyAll", label: "Sell All", group: this.t("key.group.upgrades") }
        ];
    }

    getHudKeybindLabel (actionKey) {
        const defs = this.getKeybindActionDefinitions();
        const found = defs.find((def) => def.key === actionKey);
        return found?.label || actionKey;
    }

    findHudKeybindConflict (actionKey, keyValue) {
        const normalized = this.normalizeKeybindValue(keyValue);
        if (!normalized) return null;
        const all = this.hudConfig?.keybinds || {};
        const keys = Object.keys(all);
        for (let i = 0; i < keys.length; i += 1) {
            const k = keys[i];
            if (k === actionKey) continue;
            const candidate = this.normalizeKeybindValue(all[k]);
            if (candidate && candidate === normalized) {
                return {
                    actionKey: k,
                    label: this.getHudKeybindLabel(k)
                };
            }
        }
        return null;
    }

    setHudKeybindValue (actionKey, keyValue, options = {}) {
        const { warnOnConflict = true } = options || {};
        const normalized = this.normalizeKeybindValue(keyValue);
        if (!this.hudConfig.keybinds) this.hudConfig.keybinds = {};

        if (normalized === "unidentified" || normalized === "process") {
            return { ok: false };
        }

        if (!normalized) {
            this.hudConfig.keybinds[actionKey] = "";
            this.scheduleHudConfigSync();
            this.refreshCustomizationSettingsUI();
            this.refreshKeybindEditorUI();
            return { ok: true };
        }

        if (this.isReservedGameplayKeybind(normalized)) {
            if (warnOnConflict) {
                this.notifySystemWarning(this.getReservedGameplayKeybindNotice(normalized));
            }
            this.refreshCustomizationSettingsUI();
            this.refreshKeybindEditorUI();
            return { ok: false, reserved: true };
        }

        const conflict = this.findConfiguredKeyConflict(normalized, {
            excludeScope: "hud",
            excludeId: actionKey
        }) || this.findHudKeybindConflict(actionKey, normalized);
        if (conflict && warnOnConflict) {
            this.showKeyConflictNotice(normalized, conflict, { assigned: true });
        }

        this.hudConfig.keybinds[actionKey] = normalized;
        this.scheduleHudConfigSync();
        this.refreshCustomizationSettingsUI();
        this.refreshKeybindEditorUI();
        return { ok: true, conflict: conflict || null };
    }

    getUnitStyleOption (key, fallback) {
        const v = this.hudConfig?.unitStyles?.[key];
        return (typeof v === "string" && v.trim()) ? v : fallback;
    }

    showUnitStyleEditor (show = true) {
        if (!show) {
            if (this.unitStyleEditorOverlay?.parentNode) {
                this.unitStyleEditorOverlay.parentNode.removeChild(this.unitStyleEditorOverlay);
            }
            this.unitStyleEditorOverlay = null;
            return;
        }
        this.showUnitStyleEditor(false);

        const overlay = document.createElement("div");
        overlay.className = "unit-style-editor-overlay";
        overlay.innerHTML = `
            <div class="unit-style-editor-card">
                <div class="unit-style-editor-header">
                    <h3>Unit Models</h3>
                    <button type="button" class="unit-style-editor-close">x</button>
                </div>
                <p class="unit-style-editor-help">${this.t("hud.unitHelp")}</p>
                <div class="unit-style-editor-section">
                    <div class="unit-style-editor-title">Shapes</div>
                    <div class="unit-style-editor-shapes">
                        <label>Soldier
                            <select data-shape-key="soldier">
                                <option value="round">Round</option>
                                <option value="triangle">Triangle</option>
                            </select>
                        </label>
                        <label>Tank
                            <select data-shape-key="tank">
                                <option value="round">Round</option>
                                <option value="triangle">Triangle</option>
                            </select>
                        </label>
                        <label>Siege
                            <select data-shape-key="siege">
                                <option value="round">Round</option>
                                <option value="triangle">Triangle</option>
                            </select>
                        </label>
                    </div>
                </div>
                <div class="unit-style-editor-section">
                    <div class="unit-style-editor-title">Soldier Models (5)</div>
                    <div class="unit-style-editor-model-grid" data-model-grid="soldier"></div>
                </div>
                <div class="unit-style-editor-section">
                    <div class="unit-style-editor-title">Tank Models (5)</div>
                    <div class="unit-style-editor-model-grid" data-model-grid="tank"></div>
                </div>
                <div class="unit-style-editor-section">
                    <div class="unit-style-editor-title">Siege Models (5)</div>
                    <div class="unit-style-editor-model-grid" data-model-grid="siege"></div>
                </div>
                <div class="unit-style-editor-footer">
                    <button type="button" class="unit-style-editor-reset">${this.t("hud.reset")}</button>
                    <button type="button" class="unit-style-editor-done">${this.t("hud.close")}</button>
                </div>
            </div>
        `;

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) this.showUnitStyleEditor(false);
        });
        overlay.querySelector(".unit-style-editor-close")?.addEventListener("click", () => this.showUnitStyleEditor(false));
        overlay.querySelector(".unit-style-editor-done")?.addEventListener("click", () => this.showUnitStyleEditor(false));
        overlay.querySelector(".unit-style-editor-reset")?.addEventListener("click", () => {
            this.hudConfig.unitShapes = { ...this.getDefaultHudConfig().unitShapes };
            this.hudConfig.unitStyles = { ...this.getDefaultHudConfig().unitStyles };
            this.scheduleHudConfigSync();
            this.refreshCustomizationSettingsUI();
            this.refreshUnitStyleEditorUI();
            this.applyHudConfig();
        });

        overlay.querySelectorAll("[data-shape-key]").forEach((select) => {
            select.addEventListener("change", () => {
                const key = select.dataset.shapeKey;
                this.hudConfig.unitShapes[key] = select.value;
                this.scheduleHudConfigSync();
                this.refreshCustomizationSettingsUI();
                this.applyHudConfig();
                this.refreshUnitStyleEditorUI();
            });
        });

        document.body.appendChild(overlay);
        this.unitStyleEditorOverlay = overlay;
        this.refreshUnitStyleEditorUI();
    }

    refreshUnitStyleEditorUI () {
        const overlay = this.unitStyleEditorOverlay;
        if (!overlay) return;
        overlay.querySelectorAll("[data-shape-key]").forEach((select) => {
            const key = select.dataset.shapeKey;
            select.value = this.hudConfig?.unitShapes?.[key] || "triangle";
        });

        const models = ["model1", "model2", "model3", "model4", "model5"];
        const units = [
            { key: "soldier", label: "Soldier" },
            { key: "tank", label: "Tank" },
            { key: "siege", label: "Siege" }
        ];
        units.forEach((unit) => {
            const grid = overlay.querySelector(`[data-model-grid="${unit.key}"]`);
            if (!grid) return;
            grid.innerHTML = "";
            const selected = this.getUnitStyleOption(`${unit.key}Model`, "model1");
            models.forEach((model, index) => {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "unit-model-card";
                if (model === selected) btn.classList.add("selected");
                btn.innerHTML = `
                    <div class="unit-model-preview ${model} ${this.hudConfig?.unitShapes?.[unit.key] || "round"} unit-type-${unit.key}"></div>
                    <div class="unit-model-label">${unit.label} ${index + 1}</div>
                `;
                btn.addEventListener("click", () => {
                    if (!this.hudConfig.unitStyles) this.hudConfig.unitStyles = {};
                    this.hudConfig.unitStyles[`${unit.key}Model`] = model;
                    this.scheduleHudConfigSync();
                    this.refreshUnitStyleEditorUI();
                    this.applyHudConfig();
                });
                grid.appendChild(btn);
            });
        });
    }

    applyHudConfig () {
        if (typeof window !== "undefined") {
            window.__warhexHudConfig = this.hudConfig;
        }
        const applyPanel = (selector, cfg, fallback, options = {}) => {
            const el = typeof selector === "string" ? document.querySelector(selector) : selector;
            if (!el) return;

            const viewportWidth = Math.max(320, Number(window?.innerWidth) || document.documentElement.clientWidth || 1920);
            const viewportHeight = Math.max(240, Number(window?.innerHeight) || document.documentElement.clientHeight || 1080);
            const parseNumber = (value) => {
                if (value === null || value === undefined || value === "") return null;
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : null;
            };

            const rawX = parseNumber(cfg?.x);
            const rawY = parseNumber(cfg?.y);
            const rawWidth = parseNumber(cfg?.width);
            const rawHeight = parseNumber(cfg?.height);

            const hasCustomPosition = rawX != null || rawY != null;
            const clampedX = rawX == null ? null : Math.max(0, Math.min(viewportWidth - 80, rawX));
            const clampedY = rawY == null ? null : Math.max(0, Math.min(viewportHeight - 60, rawY));
            const clampedWidth = rawWidth == null ? null : Math.max(160, Math.min(viewportWidth - 8, rawWidth));
            const clampedHeight = rawHeight == null ? null : Math.max(80, Math.min(viewportHeight - 8, rawHeight));

            el.style.position = "fixed";
            el.style.left = clampedX != null ? `${clampedX}px` : (fallback.left ?? "");
            el.style.top = clampedY != null ? `${clampedY}px` : (fallback.top ?? "");
            el.style.right = clampedX != null ? "auto" : (fallback.right ?? "");
            el.style.bottom = clampedY != null ? "auto" : (fallback.bottom ?? "");
            el.style.width = clampedWidth != null ? `${clampedWidth}px` : "";
            el.style.maxWidth = clampedWidth != null ? `${clampedWidth}px` : "";
            el.style.height = clampedHeight != null ? `${clampedHeight}px` : "";
            el.style.maxHeight = clampedHeight != null ? `${clampedHeight}px` : "";
            if (options.clearTransformOnCustom) {
                el.style.transform = hasCustomPosition ? "none" : "";
            }
        };

        applyPanel("#chat", this.hudConfig?.hud?.chat, { right: "0px", bottom: "0px" });
        applyPanel("#leaderboard-container .leaderboard", this.hudConfig?.hud?.leaderboard, { right: "0px", top: "0px" });
        applyPanel("#global-leaderboard", this.hudConfig?.hud?.globalRank, { right: "0px", top: "0px" });
        applyPanel("#resource-container", this.hudConfig?.hud?.resources, { left: "8px", bottom: "8px" });
        applyPanel("#shield", this.hudConfig?.hud?.protection, { left: "8px", bottom: "80px" });
        applyPanel("#toolbar-container", this.hudConfig?.hud?.toolbar, { bottom: "0px", left: "" }, { clearTransformOnCustom: true });
        applyPanel("#upgrade-container", this.hudConfig?.hud?.upgrades, { left: "8px", top: "" });
        this.applyCameraControlsFromHudConfig({ applyZoom: !this._cameraZoomInitialized });
        this._cameraZoomInitialized = true;
        this.ensureHudCollapseControls();
        this.applyHudCollapsedStates();
        this.applyHudVisibilityStates();
    }

    ensureHudCollapseControls () {
        const specs = [
            { key: "chat", selector: "#chat", placement: "absolute" },
            { key: "leaderboard", selector: "#leaderboard-container .leaderboard", placement: "absolute" },
            { key: "toolbar", selector: "#toolbar-container", placement: "absolute" },
            { key: "groupTroops", selector: "#unit-controls-container", placement: "inline" }
        ];
        specs.forEach((spec) => {
            const el = document.querySelector(spec.selector);
            if (!el) return;

            let btn = el.querySelector(`.hud-collapse-toggle[data-hud-collapse="${spec.key}"]`);
            if (!btn) {
                btn = document.createElement("button");
                btn.type = "button";
                btn.className = `hud-collapse-toggle ${spec.placement === "inline" ? "inline" : "floating"}`;
                btn.dataset.hudCollapse = spec.key;
                btn.title = this.t("hud.minimizeExpand");
                btn.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const current = Boolean(this.hudConfig?.collapsedPanels?.[spec.key]);
                    this.setHudPanelCollapsed(spec.key, !current);
                });
            }

            if (spec.key === "leaderboard") {
                const title = el.querySelector("h2");
                if (title) {
                    btn.classList.remove("floating");
                    btn.classList.add("inline", "leaderboard-inline");
                    if (btn.parentElement !== title) title.appendChild(btn);
                } else if (btn.parentElement !== el) {
                    btn.classList.remove("inline", "leaderboard-inline");
                    btn.classList.add("floating");
                    el.appendChild(btn);
                }
            } else {
                if (btn.parentElement !== el) el.appendChild(btn);
            }
        });
    }

    setHudPanelCollapsed (key, collapsed) {
        if (!this.hudConfig.collapsedPanels) {
            this.hudConfig.collapsedPanels = { ...this.getDefaultHudConfig().collapsedPanels };
        }
        this.hudConfig.collapsedPanels[key] = Boolean(collapsed);
        this.applyHudCollapsedStates();
        this.scheduleHudConfigSync();
    }

    toggleHudPanelCollapsed (key) {
        const current = Boolean(this.hudConfig?.collapsedPanels?.[key]);
        this.setHudPanelCollapsed(key, !current);
        return !current;
    }

    getHudPanelVisible (key, fallback = true) {
        if (!key) return Boolean(fallback);
        const value = this.hudConfig?.hudVisibility?.[key];
        if (value === null || value === undefined) return Boolean(fallback);
        return value !== false;
    }

    setHudPanelVisible (key, visible, options = {}) {
        if (!key) return;
        if (!this.hudConfig.hudVisibility || typeof this.hudConfig.hudVisibility !== "object") {
            this.hudConfig.hudVisibility = { ...this.getDefaultHudConfig().hudVisibility };
        }
        this.hudConfig.hudVisibility[key] = Boolean(visible);
        this.applyHudVisibilityStates();
        if (options?.persist !== false) {
            this.scheduleHudConfigSync();
        }
    }

    toggleHudPanelVisibility (key, options = {}) {
        const next = !this.getHudPanelVisible(key, true);
        this.setHudPanelVisible(key, next, options);
        return next;
    }

    toggleHudMiniMapVisibility (options = {}) {
        const next = !this.getHudPanelVisible("miniMap", true);
        this.setHudPanelVisible("miniMap", next, options);
        return next;
    }

    applyHudCollapsedStates () {
        const states = this.hudConfig?.collapsedPanels || {};
        const bind = (selector, key) => {
            const el = document.querySelector(selector);
            if (!el) return;
            const collapsed = Boolean(states[key]);
            el.classList.toggle("hud-panel-collapsed", collapsed);
            const btn = el.querySelector(`.hud-collapse-toggle[data-hud-collapse="${key}"]`);
            if (btn) {
                btn.textContent = collapsed ? "+" : "-";
                btn.setAttribute("aria-label", collapsed ? this.t("hud.expandPanel") : this.t("hud.minimizePanel"));
                btn.title = collapsed ? this.t("hud.expand") : this.t("hud.minimize");
            }
        };

        bind("#chat", "chat");
        bind("#leaderboard-container .leaderboard", "leaderboard");
        bind("#toolbar-container", "toolbar");
        bind("#unit-controls-container", "groupTroops");
    }

    applyHudVisibilityStates () {
        if (this.menuOpen) {
            this.showMiniMap(false);
            this.showToolbar(false);
            this.showUnitControls(false);
            return;
        }
        this.showMiniMap(this.getHudPanelVisible("miniMap", true));
        this.showToolbar(this.getHudPanelVisible("toolbar", true));
        this.showUnitControls(this.getHudPanelVisible("groupTroops", true));
    }

    saveHudLayoutFromPanels ({ onlyIfDirty = false } = {}) {
        if (onlyIfDirty && !this.hudLayoutDirty) {
            return false;
        }
        this.captureHudPanelLayout("#chat", "chat");
        this.captureHudPanelLayout("#leaderboard-container .leaderboard", "leaderboard");
        this.captureHudPanelLayout("#global-leaderboard", "globalRank");
        this.captureHudPanelLayout("#resource-container", "resources");
        this.captureHudPanelLayout("#shield", "protection");
        this.captureHudPanelLayout("#toolbar-container", "toolbar");
        this.captureHudPanelLayout("#upgrade-container", "upgrades");
        this.scheduleHudConfigSync();
        this.hudLayoutDirty = false;
        return true;
    }

    captureHudPanelLayout (selector, targetConfigKey) {
        const el = document.querySelector(selector);
        if (!el || !this.hudConfig?.hud?.[targetConfigKey]) return;
        const rect = el.getBoundingClientRect();
        const zoomFactor = Math.max(0.01, Number(getComputedStyle(el).zoom) || 1);
        this.hudConfig.hud[targetConfigKey] = {
            x: Math.round(rect.left / zoomFactor),
            y: Math.round(rect.top / zoomFactor),
            width: Math.round(rect.width / zoomFactor),
            height: Math.round(rect.height / zoomFactor)
        };
    }

    resetHudLayoutConfig () {
        this.hudConfig.hud = this.getDefaultHudConfig().hud;
        this.applyHudConfig();
        this.scheduleHudConfigSync();
    }

    setHudCustomizeMode (enabled) {
        this.hudCustomizeMode = Boolean(enabled);
        document.body.classList.toggle("hud-customize-mode", this.hudCustomizeMode);
        if (this.hudCustomizeMode) {
            this.hudLayoutDirty = false;
            this.enableHudDragResize();
        } else {
            this.disableHudDragResize();
        }
        this.refreshCustomizationSettingsUI();
    }

    enableHudDragResize () {
        this.disableHudDragResize();
        const targets = [
            { selector: "#chat", key: "chat" },
            { selector: "#leaderboard-container .leaderboard", key: "leaderboard" },
            { selector: "#global-leaderboard", key: "globalRank" },
            { selector: "#resource-container", key: "resources" },
            { selector: "#shield", key: "protection" },
            { selector: "#toolbar-container", key: "toolbar" },
            { selector: "#upgrade-container", key: "upgrades" }
        ];

        targets.forEach(({ selector, key }) => {
            const el = document.querySelector(selector);
            if (!el) return;
            el.classList.add("hud-customizable");
            el.dataset.hudKey = key;

            let handle = el.querySelector(".hud-resize-handle");
            if (!handle) {
                handle = document.createElement("div");
                handle.className = "hud-resize-handle";
                el.appendChild(handle);
            }

            const canStart = (event) => {
                if (!this.hudCustomizeMode) return false;
                const tag = event.target?.tagName?.toLowerCase();
                if (["input", "textarea", "button", "select"].includes(tag)) return false;
                return true;
            };

            const onDragMouseDown = (event) => {
                if (!canStart(event)) return;
                if (event.target === handle) return;
                event.preventDefault();
                const rect = el.getBoundingClientRect();
                const pointerOffsetX = event.clientX - rect.left;
                const pointerOffsetY = event.clientY - rect.top;
                el.style.right = "auto";
                el.style.bottom = "auto";
                const zoomFactor = Math.max(0.01, Number(getComputedStyle(el).zoom) || 1);
                el.style.left = `${Math.round(rect.left / zoomFactor)}px`;
                el.style.top = `${Math.round(rect.top / zoomFactor)}px`;

                const onMove = (e) => {
                    const leftVisual = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - pointerOffsetX));
                    const topVisual = Math.max(0, Math.min(window.innerHeight - 60, e.clientY - pointerOffsetY));
                    el.style.left = `${Math.round(leftVisual / zoomFactor)}px`;
                    el.style.top = `${Math.round(topVisual / zoomFactor)}px`;
                };
                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    this.hudLayoutDirty = true;
                    this.captureHudPanelLayout(selector, key);
                    this.scheduleHudConfigSync();
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            };

            const onResizeMouseDown = (event) => {
                if (!this.hudCustomizeMode) return;
                event.preventDefault();
                event.stopPropagation();
                const startX = event.clientX;
                const startY = event.clientY;
                const rect = el.getBoundingClientRect();
                const zoomFactor = Math.max(0.01, Number(getComputedStyle(el).zoom) || 1);
                const startW = rect.width;
                const startH = rect.height;
                el.style.left = `${Math.round(rect.left / zoomFactor)}px`;
                el.style.top = `${Math.round(rect.top / zoomFactor)}px`;
                el.style.right = "auto";
                el.style.bottom = "auto";

                const onMove = (e) => {
                    const dw = (e.clientX - startX);
                    const dh = (e.clientY - startY);
                    const widthVisual = Math.max(180, Math.min(window.innerWidth - rect.left, startW + dw));
                    const heightVisual = Math.max(100, Math.min(window.innerHeight - rect.top, startH + dh));
                    const widthCss = Math.round(widthVisual / zoomFactor);
                    const heightCss = Math.round(heightVisual / zoomFactor);
                    el.style.width = `${widthCss}px`;
                    el.style.maxWidth = `${widthCss}px`;
                    el.style.height = `${heightCss}px`;
                    el.style.maxHeight = `${heightCss}px`;
                };
                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                    this.hudLayoutDirty = true;
                    this.captureHudPanelLayout(selector, key);
                    this.scheduleHudConfigSync();
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            };

            el.addEventListener("mousedown", onDragMouseDown);
            handle.addEventListener("mousedown", onResizeMouseDown);
            this.hudCustomizeBindings.push({ el, handle, onDragMouseDown, onResizeMouseDown });
        });
    }

    disableHudDragResize () {
        this.hudCustomizeBindings.forEach(({ el, handle, onDragMouseDown, onResizeMouseDown }) => {
            el?.classList?.remove("hud-customizable");
            if (el && onDragMouseDown) el.removeEventListener("mousedown", onDragMouseDown);
            if (handle && onResizeMouseDown) handle.removeEventListener("mousedown", onResizeMouseDown);
        });
        this.hudCustomizeBindings = [];
    }

    initializeCustomizationSettingsUI () {
        const settingsPanel = this.DOM?.settings?.panel;
        if (!settingsPanel || settingsPanel.querySelector("#hud-customization-panel")) return;

        const wrap = document.createElement("div");
        wrap.id = "hud-customization-panel";
        wrap.className = "hud-customization-panel";
        wrap.innerHTML = `
            <h3>HUD Customization</h3>
            <p class="hud-customization-help">Use Keybind Manager to configure all keys (selection, commander combos, upgrades and direct upgrade hotkeys with preview). Layout edit controls stay here.</p>
            <div class="hud-customization-actions">
                <button type="button" id="hud-open-keybind-screen">Keybind Manager</button>
                <button type="button" id="hud-customize-toggle">Enable HUD Edit</button>
                <button type="button" id="hud-customize-save">Save Layout</button>
                <button type="button" id="hud-customize-reset">Reset HUD</button>
            </div>
            <div class="hud-camera-controls">
                <label>Camera Speed <input id="hud-camera-speed" type="number" min="0.5" max="20" step="0.1" value="3"></label>
                <label>Camera Zoom <input id="hud-camera-zoom" type="number" min="0.05" max="8" step="0.05" value="1.5"></label>
            </div>
            <div class="hud-unit-shape-controls">
                <label>Soldier Shape
                    <select id="hud-shape-soldier">
                        <option value="triangle">Triangle</option>
                        <option value="round">Round</option>
                    </select>
                </label>
                <label>Tank Shape
                    <select id="hud-shape-tank">
                        <option value="triangle">Triangle</option>
                        <option value="round">Round</option>
                    </select>
                </label>
                <label>Siege Shape
                    <select id="hud-shape-siege">
                        <option value="triangle">Triangle</option>
                        <option value="round">Round</option>
                    </select>
                </label>
                <button type="button" id="hud-open-model-screen" class="hud-open-model-btn">Unit Models</button>
            </div>
            <div class="hud-customization-shortcuts">
                <span>Tip: Key changes are saved automatically while you edit in Keybind Manager.</span>
            </div>
        `;
        settingsPanel.appendChild(wrap);

        const openKeyScreenBtn = wrap.querySelector("#hud-open-keybind-screen");
        const openModelScreenBtn = wrap.querySelector("#hud-open-model-screen");
        const toggleBtn = wrap.querySelector("#hud-customize-toggle");
        const saveBtn = wrap.querySelector("#hud-customize-save");
        const resetBtn = wrap.querySelector("#hud-customize-reset");
        const bindMouseHotkeyInput = (el) => {
            if (!el) return;
            el.addEventListener("contextmenu", (event) => {
                event.preventDefault();
            });
            el.addEventListener("mousedown", (event) => {
                if (!Number.isInteger(event.button) || event.button < 1) return;
                event.preventDefault();
                event.stopPropagation();
                const mouseKey = this.normalizeKeybindValue(`mouse${event.button + 1}`);
                if (!mouseKey) return;
                el.value = mouseKey;
                el.dispatchEvent(new Event("input"));
            });
        };
        const bindInput = (id, path, key) => {
            const el = wrap.querySelector(id);
            if (!el) return;
            el.addEventListener("input", () => {
                const value = this.normalizeKeybindValue(el.value);
                el.value = value;
                if (path === "keybinds") {
                    const result = this.setHudKeybindValue(key, value, { warnOnConflict: true });
                    if (!result?.ok) {
                        el.value = this.normalizeKeybindValue(this.hudConfig?.keybinds?.[key] || "");
                    }
                    return;
                }
                if (path === "unitShapes") this.hudConfig.unitShapes[key] = value || this.getDefaultHudConfig().unitShapes[key];
                this.scheduleHudConfigSync();
            });
            el.addEventListener("keydown", (e) => {
                if (e.key === "Tab") return;
                e.preventDefault();
                if (e.key === "Backspace" || e.key === "Delete") {
                    el.value = "";
                    el.dispatchEvent(new Event("input"));
                    return;
                }
                const pressed = this.normalizeKeybindValue(e.key);
                if (!pressed || pressed === "escape") return;
                el.value = pressed;
                el.dispatchEvent(new Event("input"));
            });
            bindMouseHotkeyInput(el);
        };
        const bindSelect = (id, key) => {
            const el = wrap.querySelector(id);
            if (!el) return;
            el.addEventListener("change", () => {
                this.hudConfig.unitShapes[key] = el.value;
                this.scheduleHudConfigSync();
            });
        };
        const bindCameraInput = (id, key) => {
            const el = wrap.querySelector(id);
            if (!el) return;
            const applyFromField = () => {
                this.setCameraControlValue(key, el.value, { applyZoom: key === "zoom" });
            };
            el.addEventListener("change", applyFromField);
            el.addEventListener("blur", applyFromField);
        };

        openKeyScreenBtn?.addEventListener("click", () => this.showKeybindEditor(true));
        openModelScreenBtn?.addEventListener("click", () => this.showUnitStyleEditor(true));
        toggleBtn?.addEventListener("click", () => this.setHudCustomizeMode(!this.hudCustomizeMode));
        saveBtn?.addEventListener("click", () => {
            this.saveHudLayoutFromPanels({ onlyIfDirty: true });
            this.setHudCustomizeMode(false);
        });
        resetBtn?.addEventListener("click", () => this.resetHudLayoutConfig());

        bindInput("#hud-key-select-army", "keybinds", "selectArmy");
        bindInput("#hud-key-select-commander", "keybinds", "selectCommander");
        bindInput("#hud-key-select-all", "keybinds", "selectAllUnits");
        bindInput("#hud-key-toggle-map", "keybinds", "toggleMap");
        bindInput("#hud-key-group-troops", "keybinds", "toggleGroupTroops");
        bindInput("#hud-key-select-soldiers-only", "keybinds", "selectSoldiersOnly");
        bindInput("#hud-key-select-tanks-only", "keybinds", "selectTanksOnly");
        bindInput("#hud-key-select-siege-only", "keybinds", "selectSiegeOnly");
        bindInput("#hud-key-upgrade-1", "keybinds", "upgrade1");
        bindInput("#hud-key-upgrade-2", "keybinds", "upgrade2");
        bindInput("#hud-key-upgrade-3", "keybinds", "upgrade3");
        bindInput("#hud-key-upgrade-destroy", "keybinds", "upgradeDestroy");
        bindInput("#hud-key-upgrade-barracks", "keybinds", "upgradeBarracksToggle");
        bindInput("#hud-key-upgrade-all-mode", "keybinds", "upgradeAllMode");
        bindInput("#hud-key-upgrade-destroy-all", "keybinds", "upgradeDestroyAll");
        bindCameraInput("#hud-camera-speed", "speed");
        bindCameraInput("#hud-camera-zoom", "zoom");
        bindSelect("#hud-shape-soldier", "soldier");
        bindSelect("#hud-shape-tank", "tank");
        bindSelect("#hud-shape-siege", "siege");

        this.refreshCustomizationSettingsUI();
    }

    refreshCustomizationSettingsUI () {
        const wrap = document.getElementById("hud-customization-panel");
        if (!wrap) return;
        const setVal = (sel, value) => {
            const el = wrap.querySelector(sel);
            if (el && value != null) el.value = value;
        };
        setVal("#hud-key-select-army", this.hudConfig?.keybinds?.selectArmy ?? "q");
        setVal("#hud-key-select-commander", this.hudConfig?.keybinds?.selectCommander ?? "c");
        setVal("#hud-key-select-all", this.hudConfig?.keybinds?.selectAllUnits ?? "e");
        setVal("#hud-key-toggle-map", this.hudConfig?.keybinds?.toggleMap ?? "m");
        setVal("#hud-key-group-troops", this.hudConfig?.keybinds?.toggleGroupTroops ?? "z");
        setVal("#hud-key-select-soldiers-only", this.hudConfig?.keybinds?.selectSoldiersOnly ?? "x");
        setVal("#hud-key-select-tanks-only", this.hudConfig?.keybinds?.selectTanksOnly ?? "v");
        setVal("#hud-key-select-siege-only", this.hudConfig?.keybinds?.selectSiegeOnly ?? "b");
        setVal("#hud-key-upgrade-1", this.hudConfig?.keybinds?.upgrade1 ?? "q");
        setVal("#hud-key-upgrade-2", this.hudConfig?.keybinds?.upgrade2 ?? "e");
        setVal("#hud-key-upgrade-3", this.hudConfig?.keybinds?.upgrade3 ?? "t");
        setVal("#hud-key-upgrade-destroy", this.hudConfig?.keybinds?.upgradeDestroy ?? "r");
        setVal("#hud-key-upgrade-barracks", this.hudConfig?.keybinds?.upgradeBarracksToggle ?? "f");
        setVal("#hud-key-upgrade-all-mode", this.hudConfig?.keybinds?.upgradeAllMode ?? "y");
        setVal("#hud-key-upgrade-destroy-all", this.hudConfig?.keybinds?.upgradeDestroyAll ?? "u");
        setVal("#hud-camera-speed", String(this.getCameraControlValue("speed", 3)));
        setVal("#hud-camera-zoom", String(this.getCameraControlValue("zoom", 1.5)));
        setVal("#hud-shape-soldier", this.hudConfig?.unitShapes?.soldier || "triangle");
        setVal("#hud-shape-tank", this.hudConfig?.unitShapes?.tank || "triangle");
        setVal("#hud-shape-siege", this.hudConfig?.unitShapes?.siege || "triangle");
        this.renderUpgradeHotkeySettingsUI(wrap);
        const keyScreenBtn = wrap.querySelector("#hud-open-keybind-screen");
        if (keyScreenBtn) keyScreenBtn.textContent = "Keybind Manager";
        const toggleBtn = wrap.querySelector("#hud-customize-toggle");
        if (toggleBtn) toggleBtn.textContent = this.hudCustomizeMode ? "Disable HUD Edit" : "Enable HUD Edit";
    }

    renderUpgradeHotkeySettingsUI (wrap = null) {
        const panel = wrap || document.getElementById("hud-customization-panel");
        if (!panel) return;
        const list = panel.querySelector("#hud-upgrade-hotkey-list");
        if (!list) return;

        this.stopPreviewAnimationsIn(list);
        list.innerHTML = "";
        const defs = this.getUpgradeHotkeyDefinitions();
        const validIds = new Set(defs.map((def) => def.id));
        if (this.hudConfig?.upgradeHotkeys && typeof this.hudConfig.upgradeHotkeys === "object") {
            let removedAny = false;
            Object.keys(this.hudConfig.upgradeHotkeys).forEach((id) => {
                if (!validIds.has(id)) {
                    delete this.hudConfig.upgradeHotkeys[id];
                    removedAny = true;
                }
            });
            if (removedAny) {
                this.scheduleHudConfigSync();
            }
        }
        let renderedSection = "";
        defs.forEach((def) => {
            const currentSection = String(def.section || "Other");
            if (renderedSection !== currentSection) {
                renderedSection = currentSection;
                const sectionTitle = document.createElement("div");
                sectionTitle.className = "hud-upgrade-hotkey-group";
                sectionTitle.dataset.hotkeySection = currentSection;
                sectionTitle.textContent = currentSection;
                list.appendChild(sectionTitle);
            }

            const row = document.createElement("label");
            row.className = "hud-upgrade-hotkey-row";

            this.appendUpgradeHotkeyPreview(row, def, { size: 30 });

            const title = document.createElement("span");
            title.className = "hud-upgrade-hotkey-label";
            title.textContent = def.label;

            const input = document.createElement("input");
            input.type = "text";
            input.maxLength = 24;
            input.value = this.getUpgradeHotkeyValue(def.id);
            input.placeholder = "Set key";
            input.dataset.upgradeHotkeyId = def.id;

            input.addEventListener("input", () => {
                const normalized = this.normalizeKeybindValue(input.value);
                input.value = normalized;
                const result = this.setUpgradeHotkeyValue(def.id, normalized, { warnOnConflict: true });
                if (!result?.ok) {
                    input.value = this.getUpgradeHotkeyValue(def.id);
                }
            });

            input.addEventListener("keydown", (event) => {
                if (event.key === "Tab") return;
                event.preventDefault();
                if (event.key === "Backspace" || event.key === "Delete") {
                    input.value = "";
                    input.dispatchEvent(new Event("input"));
                    return;
                }
                const pressed = this.normalizeKeybindValue(event.key);
                if (!pressed || pressed === "escape") return;
                input.value = pressed;
                input.dispatchEvent(new Event("input"));
            });
            input.addEventListener("contextmenu", (event) => {
                event.preventDefault();
            });
            input.addEventListener("mousedown", (event) => {
                if (!Number.isInteger(event.button) || event.button < 1) return;
                event.preventDefault();
                event.stopPropagation();
                const mouseKey = this.normalizeKeybindValue(`mouse${event.button + 1}`);
                if (!mouseKey) return;
                input.value = mouseKey;
                input.dispatchEvent(new Event("input"));
            });

            row.appendChild(title);
            row.appendChild(input);
            list.appendChild(row);
        });
    }

    openCustomizationCenter (options = {}) {
        const { enableHudEdit = false } = options;
        this.showGameSettingsButton(false);
        this.showGameSettingsPanel(true);
        this.initializeCustomizationSettingsUI();
        this.refreshCustomizationSettingsUI();
        if (enableHudEdit) {
            this.setHudCustomizeMode(true);
        }
        const panel = document.getElementById("hud-customization-panel");
        if (panel && typeof panel.scrollIntoView === "function") {
            panel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    showKeybindEditor (show = true) {
        if (!show) {
            if (typeof this.keybindCaptureCleanup === "function") {
                this.keybindCaptureCleanup();
            }
            this.keybindCaptureCleanup = null;
            this.stopPreviewAnimationsIn(this.keybindEditorOverlay);
            if (this.keybindEditorOverlay?.parentNode) {
                this.keybindEditorOverlay.parentNode.removeChild(this.keybindEditorOverlay);
            }
            this.keybindEditorOverlay = null;
            return;
        }

        this.showKeybindEditor(false);

        const overlay = document.createElement("div");
        overlay.className = "keybind-editor-overlay";
        overlay.innerHTML = `
            <div class="keybind-editor-card">
                <div class="keybind-editor-header">
                    <h3>Keybind Manager</h3>
                    <button type="button" class="keybind-editor-close">x</button>
                </div>
                <p class="keybind-editor-help">${this.t("hud.keybindHelp")} Mouse buttons are supported (MOUSE 4/MOUSE 5).</p>
                <div class="keybind-editor-toolbar">
                    <input type="text" id="keybind-editor-filter" placeholder="Search keybind..." />
                </div>
                <div class="keybind-editor-list"></div>
                <div class="keybind-editor-footer">
                    <button type="button" class="keybind-editor-reset">${this.t("hud.resetKeybinds")}</button>
                    <button type="button" class="keybind-editor-done">${this.t("hud.close")}</button>
                </div>
            </div>
        `;
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) this.showKeybindEditor(false);
        });
        overlay.querySelector("#keybind-editor-filter")?.addEventListener("input", () => this.refreshKeybindEditorUI());
        overlay.querySelector(".keybind-editor-close")?.addEventListener("click", () => this.showKeybindEditor(false));
        overlay.querySelector(".keybind-editor-done")?.addEventListener("click", () => this.showKeybindEditor(false));
        overlay.querySelector(".keybind-editor-reset")?.addEventListener("click", () => {
            const defaults = this.getDefaultHudConfig().keybinds;
            this.hudConfig.keybinds = { ...defaults };
            this.hudConfig.upgradeHotkeys = {};
            this.scheduleHudConfigSync();
            this.refreshCustomizationSettingsUI();
            this.refreshKeybindEditorUI();
        });

        document.body.appendChild(overlay);
        this.keybindEditorOverlay = overlay;
        this.refreshKeybindEditorUI();
    }

    refreshKeybindEditorUI () {
        const overlay = this.keybindEditorOverlay;
        if (!overlay) return;
        const list = overlay.querySelector(".keybind-editor-list");
        if (!list) return;
        this.stopPreviewAnimationsIn(list);
        list.innerHTML = "";
        const filterInput = overlay.querySelector("#keybind-editor-filter");
        const filter = String(filterInput?.value || "").trim().toLowerCase();

        const sectionsWrap = document.createElement("div");
        sectionsWrap.className = "keybind-editor-sections";
        list.appendChild(sectionsWrap);

        const createSection = (title, subtitle = "") => {
            const section = document.createElement("section");
            section.className = "keybind-editor-section";
            const header = document.createElement("div");
            header.className = "keybind-editor-group";
            header.textContent = title;
            section.appendChild(header);
            if (subtitle) {
                const note = document.createElement("p");
                note.className = "keybind-editor-section-note";
                note.textContent = subtitle;
                section.appendChild(note);
            }
            const body = document.createElement("div");
            body.className = "keybind-editor-section-body";
            section.appendChild(body);
            sectionsWrap.appendChild(section);
            return body;
        };

        const startCapture = (valueElement, onSetValue, onClearValue) => {
            valueElement.textContent = this.t("hud.pressKey");
            const cleanup = () => {
                document.removeEventListener("keydown", onKey, true);
                document.removeEventListener("mousedown", onMouse, true);
                if (this.keybindCaptureCleanup === cleanup) {
                    this.keybindCaptureCleanup = null;
                }
            };
            if (typeof this.keybindCaptureCleanup === "function") {
                this.keybindCaptureCleanup();
            }
            this.keybindCaptureCleanup = cleanup;
            const onKey = (event) => {
                if (event.key === "Tab") return;
                event.preventDefault();
                event.stopPropagation();
                const key = this.normalizeKeybindValue(event.key);
                if (key === "escape") {
                    cleanup();
                    this.refreshKeybindEditorUI();
                    return;
                }
                if (key === "backspace" || key === "delete") {
                    cleanup();
                    onClearValue?.();
                    return;
                }
                if (!key) return;
                cleanup();
                onSetValue?.(key);
            };
            const onMouse = (event) => {
                if (!Number.isInteger(event.button) || event.button < 1) return;
                event.preventDefault();
                event.stopPropagation();
                const key = this.normalizeKeybindValue(`mouse${event.button + 1}`);
                if (!key) return;
                cleanup();
                onSetValue?.(key);
            };
            document.addEventListener("keydown", onKey, true);
            document.addEventListener("mousedown", onMouse, true);
        };

        const createRow = (labelText, valueText, options) => {
            const row = document.createElement("div");
            row.className = "keybind-editor-row";

            if (options?.previewDef) {
                row.classList.add("has-preview");
                this.appendUpgradeHotkeyPreview(row, options.previewDef, { size: 24 });
            }

            const label = document.createElement("div");
            label.className = "keybind-editor-label";
            label.textContent = labelText;

            const value = document.createElement("div");
            value.className = "keybind-editor-value";
            value.textContent = valueText;

            const setBtn = document.createElement("button");
            setBtn.type = "button";
            setBtn.className = "keybind-editor-btn";
            setBtn.textContent = this.t("hud.set");
            setBtn.addEventListener("click", () => {
                startCapture(
                    value,
                    (nextValue) => options?.onSet?.(nextValue),
                    () => options?.onClear?.()
                );
            });

            const clearBtn = document.createElement("button");
            clearBtn.type = "button";
            clearBtn.className = "keybind-editor-btn ghost";
            clearBtn.textContent = this.t("hud.clear");
            clearBtn.addEventListener("click", () => options?.onClear?.());

            row.appendChild(label);
            row.appendChild(value);
            row.appendChild(setBtn);
            row.appendChild(clearBtn);
            return row;
        };

        const defs = this.getKeybindActionDefinitions();
        const groupedActions = new Map();
        defs.forEach((def) => {
            const groupName = String(def.group || "Other");
            if (!groupedActions.has(groupName)) groupedActions.set(groupName, []);
            groupedActions.get(groupName).push(def);
        });

        groupedActions.forEach((entries, groupName) => {
            const visibleEntries = entries.filter((entry) => {
                if (!filter) return true;
                const haystack = `${entry.label} ${groupName}`.toLowerCase();
                return haystack.includes(filter);
            });
            if (visibleEntries.length === 0) return;
            const body = createSection(groupName);
            visibleEntries.forEach((entry) => {
                body.appendChild(createRow(
                    entry.label,
                    this.formatKeybindLabel(this.hudConfig?.keybinds?.[entry.key] || ""),
                    {
                        onSet: (nextValue) => this.setHudKeybindValue(entry.key, nextValue, { warnOnConflict: true }),
                        onClear: () => this.setHudKeybindValue(entry.key, "")
                    }
                ));
            });
        });

        const upgradeDefs = this.getUpgradeHotkeyDefinitions();
        const groupedUpgrades = new Map();
        upgradeDefs.forEach((def) => {
            const groupName = String(def.section || "Other");
            if (!groupedUpgrades.has(groupName)) groupedUpgrades.set(groupName, []);
            groupedUpgrades.get(groupName).push(def);
        });

        groupedUpgrades.forEach((entries, groupName) => {
            const visibleEntries = entries.filter((entry) => {
                if (!filter) return true;
                const haystack = `${entry.label} ${groupName}`.toLowerCase();
                return haystack.includes(filter);
            });
            if (visibleEntries.length === 0) return;
            const body = createSection(groupName, "Specific upgrade hotkeys");
            visibleEntries.forEach((entry) => {
                body.appendChild(createRow(
                    entry.label,
                    this.formatKeybindLabel(this.getUpgradeHotkeyValue(entry.id)),
                    {
                        previewDef: entry,
                        onSet: (nextValue) => this.setUpgradeHotkeyValue(entry.id, nextValue, { warnOnConflict: true }),
                        onClear: () => this.setUpgradeHotkeyValue(entry.id, "")
                    }
                ));
            });
        });

        if (!sectionsWrap.children.length) {
            const empty = document.createElement("div");
            empty.className = "keybind-editor-empty";
            empty.textContent = "No keybinds found for this search.";
            list.appendChild(empty);
        }
    }

    startHudEditSession () {
        if (this.hudEditSessionOverlay) return;

        this.hudEditSessionState = {
            menuWasOpen: Boolean(this.menuOpen)
        };
        if (this.menuOpen) {
            this.showMenuUIElements(false);
            this.showGameUIElements(true);
        }

        this.setHudEditPreviewPanels(true);
        this.setHudCustomizeMode(true);
        this.createHudEditSessionOverlay();
    }

    finishHudEditSession ({ save = true, restoreFactory = false } = {}) {
        if (restoreFactory) {
            this.resetHudLayoutConfig();
        } else if (save) {
            this.saveHudLayoutFromPanels({ onlyIfDirty: true });
        } else {
            // Restore the last saved layout if the user exits without saving.
            this.applyHudConfig();
        }

        this.setHudCustomizeMode(false);
        this.setHudEditPreviewPanels(false);
        this.showUnitStyleEditor(false);
        this.showKeybindEditor(false);

        if (this.hudEditSessionOverlay?.parentNode) {
            this.hudEditSessionOverlay.parentNode.removeChild(this.hudEditSessionOverlay);
        }
        this.hudEditSessionOverlay = null;

        if (this.hudEditSessionState?.menuWasOpen) {
            this.showGameUIElements(false);
            this.showMenuUIElements(true);
        }
        this.hudEditSessionState = null;
    }

    setHudEditPreviewPanels (show) {
        const upgrades = this.DOM?.game?.upgrades;
        if (!upgrades?.container || !upgrades?.list) return;

        if (show) {
            if (this.hudEditPreviewState) return;
            const titleEl = document.querySelector("#upgrade-container h1");
            this.hudEditPreviewState = {
                containerDisplay: upgrades.container.style.display,
                title: titleEl?.textContent || "",
                listHTML: upgrades.list.innerHTML,
                destroyHTML: upgrades.destroyButton?.innerHTML || "",
                destroyDisplay: upgrades.destroyButton?.style.display || ""
            };

            if (titleEl) titleEl.textContent = this.t("hud.previewUpgrades");
            upgrades.list.innerHTML = `
                <div class="upgrade-item"><div class="upgrade-description"><p class="title">Upgrade 1</p><p>Move this panel in HUD Edit.</p></div><p class="upgrade-cost">500 Power</p></div>
                <div class="upgrade-item"><div class="upgrade-description"><p class="title">Upgrade 2</p><p>Resize to your taste.</p></div><p class="upgrade-cost">800 Power</p></div>
                <div class="upgrade-item"><div class="upgrade-description"><p class="title">Upgrade 3</p><p>Preview slot for positioning.</p></div><p class="upgrade-cost">1200 Power</p></div>
            `;
            if (upgrades.destroyButton) {
                upgrades.destroyButton.style.display = "flex";
                upgrades.destroyButton.innerHTML = `<p>${this.t("game.destroySell")}</p><p class="refund-amount">+500 Power</p>`;
            }
            upgrades.container.style.display = "flex";
        } else if (this.hudEditPreviewState) {
            const prev = this.hudEditPreviewState;
            const titleEl = document.querySelector("#upgrade-container h1");
            if (titleEl) titleEl.textContent = prev.title;
            upgrades.list.innerHTML = prev.listHTML;
            if (upgrades.destroyButton) {
                upgrades.destroyButton.innerHTML = prev.destroyHTML;
                upgrades.destroyButton.style.display = prev.destroyDisplay;
            }
            upgrades.container.style.display = prev.containerDisplay;
            this.hudEditPreviewState = null;
        }
    }

    createHudEditSessionOverlay () {
        const overlay = document.createElement("div");
        overlay.id = "hud-edit-session-overlay";
        overlay.className = "hud-edit-session-overlay";
        overlay.innerHTML = `
            <div class="hud-edit-session-card">
                <div class="hud-edit-session-title">HUD Edit Mode</div>
                <div class="hud-edit-session-help">${this.t("hud.editHelp")}</div>
                <div class="hud-edit-session-actions">
                    <button type="button" class="hud-edit-btn models">${this.t("hud.models")}</button>
                    <button type="button" class="hud-edit-btn keys">${this.t("hud.keybinds")}</button>
                    <button type="button" class="hud-edit-btn save">${this.t("hud.save")}</button>
                    <button type="button" class="hud-edit-btn reset">${this.t("hud.factoryDefaults")}</button>
                    <button type="button" class="hud-edit-btn close">${this.t("hud.exit")}</button>
                </div>
            </div>
        `;

        overlay.querySelector(".hud-edit-btn.models")?.addEventListener("click", () => {
            this.showUnitStyleEditor(true);
        });
        overlay.querySelector(".hud-edit-btn.keys")?.addEventListener("click", () => {
            this.showKeybindEditor(true);
        });
        overlay.querySelector(".hud-edit-btn.save")?.addEventListener("click", () => {
            this.finishHudEditSession({ save: true });
        });
        overlay.querySelector(".hud-edit-btn.reset")?.addEventListener("click", () => {
            this.finishHudEditSession({ save: false, restoreFactory: true });
        });
        overlay.querySelector(".hud-edit-btn.close")?.addEventListener("click", () => {
            this.finishHudEditSession({ save: false });
        });

        document.body.appendChild(overlay);
        this.hudEditSessionOverlay = overlay;
    }

    placeGroupTroopsBesidePower () {
        const resourceContainer = this.DOM?.game?.resources?.container;
        const unitControls = this.DOM?.game?.unitControls?.container;
        if (!resourceContainer || !unitControls) return;

        if (unitControls.parentElement !== resourceContainer) {
            resourceContainer.appendChild(unitControls);
        }
    }

    // Initialize skins from localStorage cache immediately (no async wait)
    initializeSkinsFromCache() {
        try {
            // Try to load cached skins from localStorage
            const cachedSkins = localStorage.getItem('supabaseSkins');
            const cachedName = localStorage.getItem('equippedSkinName') || null;
            if (cachedSkins) {
                const skins = JSON.parse(cachedSkins);
                if (Array.isArray(skins) && skins.length > 0) {
                    SkinCache.supabaseSkins = skins;
                    // rebuild maps when loading from cache
                    SkinCache.supabaseIdMap = new Map();
                    SkinCache.supabaseNameToId = new Map();
                    skins.forEach(s => {
                        SkinCache.supabaseIdMap.set(s.numericId, s);
                        SkinCache.supabaseNameToId.set(s.name, s.numericId);
                    });

                    this.availableSkins = this.buildAvailableSkins(skins);
                    console.log('Skins loaded from localStorage cache:', skins.length);
                    
                    // Restore selected skin index by name
                    if (cachedName && cachedName !== 'null') {
                        const skinIndex = this.availableSkins.findIndex(s => s.name === cachedName);
                        if (skinIndex !== -1) {
                            this.currentSkinIndex = skinIndex;
                        }
                    }
                    
                    // Update UI immediately
                    this.updateSkinCircle();
                    this.updateUseButton();
                    this.applyStartupRandomSkin();
                    return;
                }
            }
        } catch (error) {
            console.warn('Could not load skins from cache:', error);
        }

        // Fallback to bundled catalog skins if available, otherwise default only.
        const fallbackSkins = this.getFallbackCatalogSkins();
        this.availableSkins = this.buildAvailableSkins(fallbackSkins);
        this.currentSkinIndex = 0;
        this.updateSkinCircle();
        this.updateUseButton();
        this.applyStartupRandomSkin();
    }

    buildAvailableSkins(rawSkins) {
        const defaultSkin = { name: 'Default', id: 0, numericId: 0, url: null };
        if (!Array.isArray(rawSkins) || rawSkins.length === 0) {
            return [defaultSkin];
        }

        const cleaned = [];
        const seenNames = new Set();
        const seenUrls = new Set();
        let nextNumericId = 200;

        for (const skin of rawSkins) {
            if (!skin) continue;

            const name = typeof skin.name === 'string' ? skin.name.trim() : '';
            const url = typeof skin.url === 'string' && skin.url.trim() ? skin.url.trim() : null;

            // Ignore broken entries from stale cache.
            if (!name || name.toLowerCase() === 'default') continue;

            const keyName = name.toLowerCase();
            const keyUrl = url || '';
            if (seenNames.has(keyName) || (keyUrl && seenUrls.has(keyUrl))) continue;

            const numericId = Number.isInteger(skin.numericId)
                ? skin.numericId
                : (Number.isInteger(skin.id) ? skin.id : nextNumericId++);

            cleaned.push({
                ...skin,
                id: skin.id ?? name,
                name,
                url,
                numericId
            });

            seenNames.add(keyName);
            if (keyUrl) seenUrls.add(keyUrl);
        }

        return [defaultSkin, ...cleaned];
    }

    getFallbackCatalogSkins() {
        const categories = ["default", "veteran", "premium"];
        const result = [];

        for (const category of categories) {
            const list = SkinCache.getAllSkinsByCategory(category) || [];
            for (const skin of list) {
                if (!skin || skin.id == null || !skin.name) continue;
                if (skin.id === 0 || skin.name === "Default") continue;
                result.push({
                    id: skin.id,
                    numericId: skin.id,
                    name: skin.name,
                    url: `assets/skins/${category}/${skin.name}.webp`
                });
            }
        }

        // Deduplicate by name.
        const seen = new Set();
        return result.filter(s => {
            if (seen.has(s.name)) return false;
            seen.add(s.name);
            return true;
        });
    }

    async loadSupabaseSkins() {
        try {
            const skins = await fetchSkins();
            if (skins.length > 0) {
                // Save to cache
                SkinCache.setSupabaseSkins(skins);
                console.log('Supabase skins fetched and cached:', skins.length);
                
                // Build available skins array (default + supabase skins)
                this.availableSkins = this.buildAvailableSkins(skins);
                
                // Get currently equipped skin
                const equippedSkinName = localStorage.getItem('equippedSkinName') || null;
                
                // Find index of equipped skin
                if (equippedSkinName && equippedSkinName !== '' && equippedSkinName !== 'null') {
                    const skinIndex = this.availableSkins.findIndex(s => s.name === equippedSkinName);
                    if (skinIndex !== -1) {
                        this.currentSkinIndex = skinIndex;
                    }
                }
                
                // Update circle display
                this.updateSkinCircle();
                this.updateUseButton();
                this.populateSkinLibrary();
                this.applyStartupRandomSkin();
            } else if (this.availableSkins.length <= 1) {
                const fallbackSkins = this.getFallbackCatalogSkins();
                if (fallbackSkins.length > 0) {
                    this.availableSkins = this.buildAvailableSkins(fallbackSkins);
                    this.currentSkinIndex = Math.min(this.currentSkinIndex, this.availableSkins.length - 1);
                    this.updateSkinCircle();
                    this.updateUseButton();
                    this.applyStartupRandomSkin();
                } else {
                    console.warn('No Supabase skins found - using cached or default');
                }
            }
        } catch (error) {
            console.error('Error loading Supabase skins:', error);
            if (this.availableSkins.length <= 1) {
                const fallbackSkins = this.getFallbackCatalogSkins();
                if (fallbackSkins.length > 0) {
                    this.availableSkins = this.buildAvailableSkins(fallbackSkins);
                    this.currentSkinIndex = 0;
                    this.updateSkinCircle();
                    this.updateUseButton();
                    this.applyStartupRandomSkin();
                }
            }
        }
    }

    applyStartupRandomSkin() {
        if (this._startupRandomSkinApplied) return;
        if (!Array.isArray(this.availableSkins) || this.availableSkins.length === 0) return;

        const minIndex = this.availableSkins.length > 1 ? 1 : 0; // Prefer non-default skin when available
        const maxIndex = this.availableSkins.length - 1;
        const randomIndex = Math.floor(Math.random() * (maxIndex - minIndex + 1)) + minIndex;

        this.currentSkinIndex = randomIndex;
        this._startupRandomSkinApplied = true;

        // Auto-equip the random skin so player doesn't need to press "Equipped".
        this.selectCurrentSkin({ persistRemote: true, refreshLibrary: false });
    }

    initializeUIElements () {
        const elementSelectors = {
            // Menu-related elements
            menu: {
                screen: "menu-container",
                playButton: "play-button",
                tutorialButton: "tutorial-button",
                menuButton: "menu-button",
                menuSettingsButton: "menu-settings-button",
                playerNameInput: "player-name",
                loggedInNickname: "logged-in-nickname",
            },

            // Game UI elements
            game: {
                container: "game-container",
                over: {
                    container: "game-over-container",
                    content: "game-over-content", // ! Look this up
                    killedBy: "killed-by-container", // ! Look this up
                    continueButton: "continue-button",
                },
                inactivityWarning: {
                    container: "inactivity-warning-container",
                    timer: "inactivity-timer",
                },
                toolbar: "toolbar-container",
                unitControls: {
                    container: "unit-controls-container",
                    groupUnitsButton: "group-units-button",
                },
                upgrades: {
                    container: "upgrade-container",
                    list: "upgrade-list",
                    destroyButton: "destroy-button",
                    exitButton: "upgrade-container-exit",
                    tabs: "upgrade-tabs",
                },
                resources: {
                    container: "resource-container",
                    power: "power",
                    shield: "shield",
                },
                miniMap: "minimap-container",
                leaderboard: "leaderboard-container",
                metrics: "game-metrics",
            },

            // Chat UI
            chat: {
                container: "chat",
                messages: "chat-messages",
                input: "chat-message-input",
                button: "chat-button",
                suggestions: "chat-suggestions-container",
            },

            // Game settings
            settings: {
                button: "#game-settings .slider button",
                panel: "#game-settings .settings",
                exitButton: "game-settings-exit",
                themeSelect: "theme-select",
                removeGridCheckbox: "remove-grid-checkbox",
            },

            // Account 
            account: {
                guestButton: "guest-button",
                accountButton: "account-button",
                signupButton: "signup-button",
                loginDialog: "login-dialog",
                signupDialog: "signup-dialog",
                signinDialog: "signin-dialog",
                handle: "account-handle",
                statsContainer: "stats-container",
                // Signup dialog inputs
                signupEmail: "signup-email",
                signupNickname: "signup-nickname",
                signupPassword: "signup-password",
                signupDiscord: "signup-discord",
                signupSubmit: "signup-submit",
                signupCancel: "signup-cancel",
                // Signin dialog inputs
                signinEmail: "signin-email",
                signinPassword: "signin-password",
                signinDiscord: "signin-discord",
                signinSubmit: "signin-submit",
                signinCancel: "signin-cancel",
                progression: {
                    progressIcon: "#level-progression .progress-icon",
                    progressBar: "#level-progression .progress-bar",
                    progressText: "#level-progression .progress-text"
                }
            },

            legal: {
                changelogOpenButton: "changelog-open-button",
                changelogDialog: "changelog-dialog",
                changelogCloseButton: "changelog-dialog-close",
                privacyOpenButton: "privacy-open-button",
                privacyDialog: "privacy-dialog",
                privacyCloseButton: "privacy-dialog-close",
                termsOpenButton: "terms-open-button",
                termsDialog: "terms-dialog",
                termsCloseButton: "terms-dialog-close",
                aboutOpenButton: "about-open-button",
                aboutDialog: "about-dialog",
                aboutCloseButton: "about-dialog-close",
                languageSelect: "language-select",
                languageLabel: "language-label",
            },

            // Skins
            skins: {
                libraryList: "skin-container",
                previewButton: "skin-preview-circle",
                libraryDialog: "skin-library-dialog",
                libraryExit: "skin-library-exit",
                containerMenu: "skin-container-menu",
                carousel: {
                    prevButton: "skin-carousel-prev",
                    nextButton: "skin-carousel-next",
                    prevButtonMenu: "skin-carousel-prev-menu",
                    nextButtonMenu: "skin-carousel-next-menu",
                },
            },
        };

        // Initialize the dom property
        this.DOM = {};


        // Recursively initialize elements into `this.DOM`
        const initializeElements = (selectors, parent) => {
            Object.entries(selectors).forEach(([key, value]) => {
                if (typeof value === "string") {
                    parent[key] = value.startsWith("#") || value.includes(" ")
                        ? document.querySelector(value)
                        : document.getElementById(value);
                } else if (typeof value === "object" && value !== null) {
                    parent[key] = {};
                    initializeElements(value, parent[key]);
                }
            });
        };


        initializeElements(elementSelectors, this.DOM);

        this.menuOpen = false;

        this.showGameUIElements(false);
        this.showGameUIElements(false);

        this._populateGlobalLeaderboard();

        // Add event listeners for chat input focus and blur
        if (this.DOM.chat.input) {
            this.DOM.chat.input.addEventListener("focus", () => {
                this.core.camera.enableControls(false);
                this.isChatInputFocused = true;
            });
            this.DOM.chat.input.addEventListener("blur", () => {
                this.core.camera.enableControls(true);
                this.isChatInputFocused = false;
                setTimeout(() => this.hidePlayerSuggestions(), 100); // Delay to allow click on suggestion
            });
            this.DOM.chat.input.addEventListener("input", (e) => {
                const value = e.target.value;
                const atIndex = value.lastIndexOf('@');
                if (atIndex !== -1) {
                    const query = value.substring(atIndex + 1);
                    this.showPlayerSuggestions(query);
                } else {
                    this.hidePlayerSuggestions();
                }
            });
        }

        if (this.DOM.game.upgrades.exitButton) {
            this.DOM.game.upgrades.exitButton.addEventListener("click", () => {
                this.core.buildingManager.deselectBuildings();
                this.hideUpgrades();
            });
        }

        // Retrieve saved color, player name, and region from local storage
        const savedPlayerName = localStorage.getItem("playerName");

        if (savedPlayerName) {
            this.DOM.menu.playerNameInput.value = savedPlayerName;
        } else if (this.DOM?.menu?.playerNameInput) {
            const guestName = this.generateGuestNickname();
            this.DOM.menu.playerNameInput.value = guestName;
            this.DOM.menu.playerNameInput.placeholder = guestName;
        }

        this.updateResources();

        // Populate theme selection dropdown and apply the saved theme
        this.populateThemeSelect();

        this.DOM.settings.themeSelect.value = ThemeManager.currentTheme;

        // Initialize remove-grid checkbox from localStorage
        if (this.DOM.settings.removeGridCheckbox) {
            this.DOM.settings.removeGridCheckbox.checked = localStorage.getItem('showGrid') === 'false';
            this.DOM.settings.removeGridCheckbox.addEventListener('change', (e) => {
                localStorage.setItem('showGrid', e.target.checked ? 'false' : 'true');
                // No need to reapply theme, grid is rendered every frame
                this.closeSettingsAfterChoice();
            });
        }
    }

    async _populateSkinLibrary () {
        const userData = this.core.networkManager.userData;
        if (!userData) {
            console.warn("No user data present.");
            return;
        }

        const addSkin = (skinData) => {
            let div = document.querySelector(`.skin-list-item[data-skin-id='${skinData.id}']`);

            if (!div) {
                // If the skin is not already in the list, create a new entry
                div = document.createElement("div");
                div.classList.add("skin-list-item");
                div.setAttribute("data-skin-id", skinData.id);

                const skinDetails = document.createElement("div");
                skinDetails.classList.add("skin-details");

                const skinTitle = document.createElement("h1");
                skinTitle.textContent = skinData.name;

                const skinImage = document.createElement("img");
                skinImage.src = `./assets/skins/veteran/${skinData.name}.webp`;
                skinImage.setAttribute("loading", "lazy");

                skinDetails.appendChild(skinTitle);
                skinDetails.appendChild(skinImage);

                div.appendChild(skinDetails);
            }

            // Check if the skin is unlocked or level-locked
            const isEquipped = skinData.id === userData.skins.equipped;
            const isUnlocked = skinData.requiredLevel && skinData.requiredLevel <= userData.progression.level;

            let button = div.querySelector("button");
            let levelLocked = div.querySelector(".skin-level-locked");

            if (isUnlocked || isEquipped) {
                // Show the button if the skin is unlocked or equipped
                if (!button) {
                    // If the button doesn't exist, create it
                    button = document.createElement("button");
                    button.textContent = isEquipped ? "Deselect" : "Select";
                    button.classList.toggle("selected", isEquipped);

                    button.addEventListener("click", () => {
                        const isSelected = button.classList.contains("selected");

                        // Deselect all other buttons first
                        const allButtons = this.DOM.skins.libraryList.querySelectorAll(".selected");
                        allButtons.forEach(btn => {
                            btn.classList.remove("selected");
                            btn.textContent = "Select";
                        });

                        if (isSelected) {
                            userData.skins.equipped = 0;
                            localStorage.setItem("equippedSkin", 0);
                            this.updateAccount();
                        } else {
                            userData.skins.equipped = skinData.id;
                            localStorage.setItem("equippedSkin", Number(skinData.id));
                            this.updateAccount();
                        }

                        button.classList.toggle("selected", !isSelected);
                        button.textContent = isSelected ? "Select" : "Deselect";
                    });

                    div.appendChild(button);
                } else {
                    // Update the existing button state
                    button.classList.toggle("selected", isEquipped);
                    button.textContent = isEquipped ? "Deselect" : "Select";
                }

                // Remove the "Level Locked" message if it's there
                if (levelLocked) {
                    levelLocked.remove();
                }
            } else {
                // If the skin is level-locked, show the "Level Locked" message and hide the button
                if (!levelLocked) {
                    levelLocked = document.createElement("div");
                    levelLocked.classList.add("skin-level-locked");

                    const lockImage = document.createElement("img");
                    lockImage.src = "./assets/icons/lock.svg";

                    const requiredLevel = document.createElement("p");
                    requiredLevel.innerText = `Level ${skinData.requiredLevel}`;

                    levelLocked.appendChild(lockImage);
                    levelLocked.appendChild(requiredLevel);

                    div.appendChild(levelLocked);
                }

                // Remove the button if it exists
                if (button) {
                    button.remove();
                }
            }

            // Append the skin item div to the library list (if it's a new entry)
            if (!div.parentElement) {
                this.DOM.skins.libraryList.appendChild(div);
            }
        };

        const veteranSkins = SkinCache.getAllSkinsByCategory("veteran");
        veteranSkins.forEach(skinData => {
            addSkin(skinData);
        });

        //! TODO: Remove when all veteran skins are implemented
        const lastSkin = veteranSkins[veteranSkins.length - 1];
        for (let i = lastSkin.requiredLevel + 5; i <= 100; i += 5) {
            const skinData = {
                id: "soon-" + i,
                name: "Soon!",
                requiredLevel: i,
            };
            addSkin(skinData);
        }
    }

    async _populateGlobalLeaderboard () {
        try {
            const leaderboard = document.getElementById("global-leaderboard");
            if (!leaderboard) {
                if (!this._globalRankElementRetryScheduled) {
                    this._globalRankElementRetryScheduled = true;
                    setTimeout(() => {
                        this._globalRankElementRetryScheduled = false;
                        this._populateGlobalLeaderboard();
                    }, 450);
                }
                return;
            }
            if (this._globalRankLoading) return;
            this._globalRankLoading = true;

            const formatPlaytime = (seconds) => {
                const total = Math.max(0, Number(seconds || 0));
                const hours = Math.floor(total / 3600);
                const minutes = Math.floor((total % 3600) / 60);
                if (hours > 0) return `${hours}h ${minutes}m`;
                return `${minutes}m`;
            };

            const formatScore = (score) => {
                const value = Math.max(0, Number(score || 0));
                return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
            };

            leaderboard.classList.add("global-account-leaderboard");
            leaderboard.innerHTML = `
                <h2>${this.t("menu.globalRank")}</h2>
                <div class="global-rank-subtitle">${this.t("menu.top10Accounts")}</div>
                <div class="global-rank-head">
                    <span>#</span>
                    <span>${this.t("menu.name")}</span>
                    <span>${this.t("menu.score")}</span>
                    <span>${this.t("menu.playtimeShort")}</span>
                    <span>${this.t("menu.kills")}</span>
                </div>
                <div class="global-rank-list"></div>
            `;
            const rowsContainer = leaderboard.querySelector(".global-rank-list");
            if (rowsContainer) {
                const loading = document.createElement("div");
                loading.className = "global-rank-empty";
                loading.textContent = this.t("menu.loadingGlobalTop");
                rowsContainer.appendChild(loading);
            }

            const leaderboardData = await fetchGlobalAccountLeaderboard(10);
            this.globalLeaderboard = leaderboardData;
            if (rowsContainer) rowsContainer.innerHTML = "";

            if (!leaderboardData.length) {
                const empty = document.createElement("div");
                empty.className = "global-rank-empty";
                empty.textContent = this.t("menu.globalRankUnavailable");
                (rowsContainer || leaderboard).appendChild(empty);
                leaderboard.style.display = "flex";
                return;
            }

            leaderboardData.forEach((entry, index) => {
                const row = document.createElement("div");
                row.className = "global-rank-row";
                const isOwnerRow = Boolean(
                    this.core?.networkManager?.isOwnerDisplayName?.(entry.name)
                );
                if (isOwnerRow) {
                    row.classList.add("owner-row");
                }
                row.innerHTML = `
                    <span class="rank">${index + 1}</span>
                    <span class="name" title="${entry.name}">${entry.name}</span>
                    <span class="score">${formatScore(entry.highscore)}</span>
                    <span class="playtime">${formatPlaytime(entry.playtime)}</span>
                    <span class="kills">${Number(entry.kills || 0).toLocaleString(this.languageManager.getLanguage())}</span>
                `;
                (rowsContainer || leaderboard).appendChild(row);
            });

            leaderboard.style.display = "flex";
        } catch (error) {
            console.error("Failed to fetch leaderboard:", error);
            const leaderboard = document.getElementById("global-leaderboard");
            if (leaderboard) {
                leaderboard.classList.add("global-account-leaderboard");
                leaderboard.innerHTML = `
                    <h2>${this.t("menu.globalRank")}</h2>
                    <div class="global-rank-subtitle">${this.t("menu.top10Accounts")}</div>
                    <div class="global-rank-empty">${this.t("menu.globalRankLoadError")}</div>
                `;
                leaderboard.style.display = "flex";
            }
        } finally {
            this._globalRankLoading = false;
            // Retry once shortly after startup if it loaded empty while session/network was still initializing.
            if (!this._globalRankRetried) {
                this._globalRankRetried = true;
                setTimeout(() => this._populateGlobalLeaderboard(), 2500);
            }
        }
    }

    embedPlayControlsIntoAccountCard () {
        const playerInputContainer = document.querySelector(".player-input-container");
        const accountContainer = document.getElementById("account-container");
        const topPlayerSettings = document.querySelector(".player-settings");
        const discordShopLinks = document.getElementById("discord-shop-links");

        if (!playerInputContainer || !accountContainer) return;
        if (playerInputContainer.dataset.embeddedIntoAccount === "1") return;

        // Place the name + play row at the top of the lower account card.
        accountContainer.insertBefore(playerInputContainer, discordShopLinks || accountContainer.firstChild);
        playerInputContainer.dataset.embeddedIntoAccount = "1";
        playerInputContainer.classList.add("embedded-in-account");
        accountContainer.classList.add("compact-account-center");

        // Hide the old top wrapper/card that would otherwise stay empty.
        if (topPlayerSettings) {
            topPlayerSettings.style.display = "none";
        }
    }

    addLoginDialogButtonListener () {
        if (this.isExternalAuthDisabled()) return;

        const accountButton = this.DOM.account.accountButton || document.getElementById("account-button");
        const signupButton = this.DOM.account.signupButton || document.getElementById("signup-button");
        const guestButton = this.DOM.account.guestButton || document.getElementById("guest-button");
        const signupSubmit = this.DOM.account.signupSubmit || document.getElementById("signup-submit");
        const signupCancel = this.DOM.account.signupCancel || document.getElementById("signup-cancel");
        const signupDiscord = this.DOM.account.signupDiscord || document.getElementById("signup-discord");
        const signinDiscord = this.DOM.account.signinDiscord || document.getElementById("signin-discord");
        const signinSubmit = this.DOM.account.signinSubmit || document.getElementById("signin-submit");
        const signinCancel = this.DOM.account.signinCancel || document.getElementById("signin-cancel");

        // Account button - opens signin dialog or logs out
        if (accountButton && !accountButton.dataset.boundLoginClick) {
            accountButton.dataset.boundLoginClick = "1";
            accountButton.addEventListener("click", () => {
                this.handleAccountButtonClick(accountButton);
            });
        }

        // Fallback for cases where the account button is re-created and loses listeners.
        if (!document.body.dataset.boundAccountDelegatedClick) {
            document.body.dataset.boundAccountDelegatedClick = "1";
            document.addEventListener("click", (event) => {
                const target = event.target;
                if (!(target instanceof HTMLElement)) return;
                const accountBtn = target.closest("#account-button");
                if (accountBtn instanceof HTMLElement) {
                    this.handleAccountButtonClick(accountBtn);
                    return;
                }
                const signupBtn = target.closest("#signup-button");
                if (signupBtn instanceof HTMLElement) {
                    this.showSignupDialog(true);
                }
            });
        }

        // Signup button - opens signup dialog
        if (signupButton && !signupButton.dataset.boundSignupClick) {
            signupButton.dataset.boundSignupClick = "1";
            signupButton.addEventListener("click", () => {
                this.showSignupDialog(true);
            });
        }

        // Guest button - closes login dialog
        if (guestButton && !guestButton.dataset.boundGuestClick) {
            guestButton.dataset.boundGuestClick = "1";
            guestButton.addEventListener("click", () => {
                this.showLoginDialog(false);
            });
        }

        const handleSignupSubmit = async () => {
            const email = String(this.DOM.account.signupEmail?.value || "").trim();
            const nickname = this.normalizeNicknameForAccount(this.DOM.account.signupNickname?.value || "");
            const password = String(this.DOM.account.signupPassword?.value || "");

            if (!email || !nickname || !password) {
                alert(this.t("error.signupMissing"));
                return;
            }

            // Basic nickname validation
            if (nickname.length < 3) {
                alert(this.t("error.nicknameShort"));
                return;
            }

            if (signupSubmit) signupSubmit.disabled = true;
            try {
                const signupData = await signUp(email, password, nickname);
                const signupSession = signupData?.session || null;
                const signupUserId = signupSession?.user?.id || null;

                if (signupUserId && this.core?.networkManager?.hydrateAuthenticatedSession) {
                    await this.core.networkManager.hydrateAuthenticatedSession(signupSession);
                    this.showSignupDialog(false);
                    this.showSigninDialog(false);
                    this.updateAccount();
                    this.updateAccountButton();
                    return;
                }

                // If email confirmation is enabled in Supabase, session is null here.
                this.showSignupDialog(false);
                this.showSigninDialog(true);
                if (this.DOM?.account?.signinEmail) {
                    this.DOM.account.signinEmail.value = email.toLowerCase();
                }
                alert(this.t("success.accountCreated"));
            } catch (error) {
                const rawMessage = String(error?.message || "");
                const normalized = rawMessage.toLowerCase();
                const alreadyRegistered = normalized.includes("already registered") || normalized.includes("user already");
                if (alreadyRegistered) {
                    this.showSignupDialog(false);
                    this.showSigninDialog(true);
                    if (this.DOM?.account?.signinEmail) {
                        this.DOM.account.signinEmail.value = email.toLowerCase();
                    }
                    alert(this.t("error.loginFailed", { message: "Conta já existe. Faça login." }));
                    return;
                }
                alert(this.t("error.signupFailed", { message: error.message }));
            } finally {
                if (signupSubmit) signupSubmit.disabled = false;
            }
        };

        // Signup dialog handlers
        if (signupSubmit && !signupSubmit.dataset.boundSignupSubmit) {
            signupSubmit.dataset.boundSignupSubmit = "1";
            signupSubmit.addEventListener("click", handleSignupSubmit);
        }

        if (signupCancel && !signupCancel.dataset.boundSignupCancel) {
            signupCancel.dataset.boundSignupCancel = "1";
            signupCancel.addEventListener("click", () => {
                this.showSignupDialog(false);
            });
        }

        const signupEmailInput = this.DOM.account.signupEmail || document.getElementById("signup-email");
        const signupNicknameInput = this.DOM.account.signupNickname || document.getElementById("signup-nickname");
        const signupPasswordInput = this.DOM.account.signupPassword || document.getElementById("signup-password");
        const onSignupEnter = async (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            await handleSignupSubmit();
        };
        if (signupEmailInput && !signupEmailInput.dataset.boundSignupEnter) {
            signupEmailInput.dataset.boundSignupEnter = "1";
            signupEmailInput.addEventListener("keydown", onSignupEnter);
        }
        if (signupNicknameInput && !signupNicknameInput.dataset.boundSignupEnter) {
            signupNicknameInput.dataset.boundSignupEnter = "1";
            signupNicknameInput.addEventListener("keydown", onSignupEnter);
        }
        if (signupPasswordInput && !signupPasswordInput.dataset.boundSignupEnter) {
            signupPasswordInput.dataset.boundSignupEnter = "1";
            signupPasswordInput.addEventListener("keydown", onSignupEnter);
        }

        if (signupDiscord && !signupDiscord.dataset.boundSignupDiscord) {
            signupDiscord.dataset.boundSignupDiscord = "1";
            signupDiscord.addEventListener("click", async () => {
                await this.startSocialOAuth("discord");
            });
        }

        if (signinDiscord && !signinDiscord.dataset.boundSigninDiscord) {
            signinDiscord.dataset.boundSigninDiscord = "1";
            signinDiscord.addEventListener("click", async () => {
                await this.startSocialOAuth("discord");
            });
        }

        const handleSigninSubmit = async () => {
            const email = String(this.DOM.account.signinEmail?.value || "").trim();
            const password = String(this.DOM.account.signinPassword?.value || "");

            if (!email || !password) {
                alert(this.t("error.signinMissing"));
                return;
            }

            if (signinSubmit) signinSubmit.disabled = true;
            try {
                const authData = await signIn(email, password);
                const session = authData?.session || null;
                const sessionUserId = session?.user?.id || null;

                if (sessionUserId && this.core?.networkManager?.hydrateAuthenticatedSession) {
                    await this.core.networkManager.hydrateAuthenticatedSession(session);
                } else {
                    await this.core.networkManager.checkLoginStatus();
                }

                try { localStorage.removeItem("warhex_oauth_pending_provider"); } catch (e) {}
                this.showSigninDialog(false);
                this.updateAccount();
                this.updateAccountButton();
            } catch (error) {
                const rawMessage = String(error?.message || "");
                const normalized = rawMessage.toLowerCase();
                const emailNotConfirmed = normalized.includes("email not confirmed")
                    || normalized.includes("email_not_confirmed");
                if (emailNotConfirmed) {
                    try {
                        await resendSignupConfirmation(email);
                    } catch (resendError) {
                        console.warn("Could not resend signup confirmation email:", resendError);
                    }
                    alert("Seu e-mail ainda não foi confirmado. Enviamos um novo e-mail de confirmação.");
                    return;
                }
                alert(this.t("error.loginFailed", { message: error.message }));
            } finally {
                if (signinSubmit) signinSubmit.disabled = false;
            }
        };

        // Signin dialog handlers
        if (signinSubmit && !signinSubmit.dataset.boundSigninSubmit) {
            signinSubmit.dataset.boundSigninSubmit = "1";
            signinSubmit.addEventListener("click", handleSigninSubmit);
        }

        const signinEmailInput = this.DOM.account.signinEmail || document.getElementById("signin-email");
        const signinPasswordInput = this.DOM.account.signinPassword || document.getElementById("signin-password");
        const onSigninEnter = async (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            await handleSigninSubmit();
        };
        if (signinEmailInput && !signinEmailInput.dataset.boundSigninEnter) {
            signinEmailInput.dataset.boundSigninEnter = "1";
            signinEmailInput.addEventListener("keydown", onSigninEnter);
        }
        if (signinPasswordInput && !signinPasswordInput.dataset.boundSigninEnter) {
            signinPasswordInput.dataset.boundSigninEnter = "1";
            signinPasswordInput.addEventListener("keydown", onSigninEnter);
        }

        if (signinCancel && !signinCancel.dataset.boundSigninCancel) {
            signinCancel.dataset.boundSigninCancel = "1";
            signinCancel.addEventListener("click", () => {
                this.showSigninDialog(false);
            });
        }
    }

    handleAccountButtonClick (buttonElement = null) {
        if (this.isExternalAuthDisabled()) return;

        const accountButton = buttonElement || this.DOM.account.accountButton || document.getElementById("account-button");
        const actionFromDataset = String(accountButton?.dataset?.authAction || "").toLowerCase();
        const buttonText = (accountButton?.textContent || "").trim().toLowerCase();
        const logoutLikeLabel = this.isLogoutLikeLabel(buttonText);
        const shouldLogout = actionFromDataset === "logout" || Boolean(this.core?.networkManager?.loggedIn) || logoutLikeLabel;
        if (shouldLogout) {
            const networkManager = this.core?.networkManager;
            let fallbackTimer = null;
            const forceLocalLogout = () => {
                try { supabaseClientApi.clearLocalAuthState?.(); } catch (e) {}
                try { localStorage.removeItem("blobl_user_data"); } catch (e) {}
                window.location.reload();
            };
            fallbackTimer = setTimeout(forceLocalLogout, 3000);
            Promise.resolve(networkManager?.logout?.())
                .finally(() => {
                    if (fallbackTimer) clearTimeout(fallbackTimer);
                });
        } else {
            this.showSigninDialog(true);
        }
    }

    showSignupDialog (show) {
        const dialog = this.DOM.account.signupDialog || document.getElementById("signup-dialog");
        if (dialog) {
            dialog.style.display = show ? "flex" : "none";
        }
    }

    showSigninDialog (show) {
        const dialog = this.DOM.account.signinDialog || document.getElementById("signin-dialog");
        if (dialog) {
            dialog.style.display = show ? "flex" : "none";
        }
    }

    normalizeNicknameForAccount (value = "") {
        const sanitized = String(value || "")
            .replace(/[\u0000-\u001F\u007F]/g, "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 20);
        return sanitized;
    }

    resolveOAuthNicknameFromUser (user) {
        const metadata = user?.user_metadata || {};
        const candidates = [
            metadata.preferred_username,
            metadata.user_name,
            metadata.full_name,
            metadata.name,
            metadata.nickname,
            (user?.email || "").split("@")[0]
        ];
        for (const candidate of candidates) {
            const normalized = this.normalizeNicknameForAccount(candidate);
            if (normalized.length >= 3) return normalized;
        }
        return "";
    }

    async promptOAuthNicknameChoice (provider = "Discord") {
        const user = await getCurrentUser();
        const ownerEmail = this.core?.networkManager?.extractEmailFromAuthUser?.(user)
            || user?.email
            || user?.user_metadata?.email
            || this.core?.networkManager?.getCurrentKnownEmail?.()
            || "";
        const isOwnerAccount = Boolean(
            this.core?.networkManager?.isOwnerAccount?.()
            || this.core?.networkManager?.isOwnerEmail?.(ownerEmail)
            || this.core?.networkManager?.isOwnerRole?.(this.core?.networkManager?.userData?.role)
        );
        if (isOwnerAccount) {
            const baseOwnerName = this.normalizeNicknameForAccount(
                this.core?.networkManager?.userData?.nickname
                || this.resolveOAuthNicknameFromUser(user)
                || "Owner"
            );
            const ownerName = this.core?.networkManager?.applyOwnerTagToName?.(baseOwnerName) || baseOwnerName;
            return ownerName || "OWNER";
        }

        const oauthNickname = this.resolveOAuthNicknameFromUser(user);
        const currentNickname = this.core?.networkManager?.userData?.nickname || "";
        const defaultNickname = currentNickname || oauthNickname || "Player";

        const useOAuthNickname = confirm(this.t("dialog.oauthNicknameChoice", { provider, nickname: oauthNickname || provider }));
        let targetNickname = "";

        if (useOAuthNickname && oauthNickname) {
            targetNickname = oauthNickname;
        } else {
            const custom = prompt(this.t("dialog.customNicknamePrompt"), defaultNickname);
            if (custom == null) return null;
            targetNickname = this.normalizeNicknameForAccount(custom);
        }

        if (targetNickname.length < 3) {
            alert(this.t("error.nicknameShort"));
            return null;
        }

        return targetNickname;
    }

    async startSocialOAuth (provider = "discord") {
        const normalizedProvider = String(provider || "").toLowerCase();
        if (normalizedProvider === "google") {
            alert(this.t("error.googleProviderDisabled"));
            return;
        }
        try {
            localStorage.setItem("warhex_oauth_pending_provider", normalizedProvider);
        } catch (e) {}

        try {
            await signInWithDiscord();
        } catch (error) {
            try { localStorage.removeItem("warhex_oauth_pending_provider"); } catch (e) {}
            const rawMessage = String(error?.message || "");
            const normalizedMessage = rawMessage.toLowerCase();
            const providerDisabled = normalizedMessage.includes("unsupported provider") || normalizedMessage.includes("provider is not enabled");
            if (providerDisabled) {
                alert(this.t(normalizedProvider === "google" ? "error.googleProviderDisabled" : "error.discordProviderDisabled"));
                return;
            }
            alert(this.t("error.discordLoginFailed", { message: error.message }));
        }
    }

    async maybeHandlePendingSocialOnboarding () {
        if (this.discordOnboardingInProgress) return;
        let pendingProvider = "";
        try {
            pendingProvider = String(localStorage.getItem("warhex_oauth_pending_provider") || "").toLowerCase();
        } catch (e) {
            pendingProvider = "";
        }
        if (!pendingProvider) return;
        if (!this.core?.networkManager?.loggedIn) return;

        this.discordOnboardingInProgress = true;
        try {
            try { localStorage.removeItem("warhex_oauth_pending_provider"); } catch (e) {}

            const providerLabel = pendingProvider === "google" ? "Google" : "Discord";
            const existingNickname = this.normalizeNicknameForAccount(this.core?.networkManager?.userData?.nickname || "");
            const isOwnerAccount = Boolean(this.core?.networkManager?.isOwnerAccount?.());
            let selectedNickname = null;

            // Do not ask nickname again if account already has one.
            if (existingNickname.length >= 3 || isOwnerAccount) {
                selectedNickname = null;
            } else {
                selectedNickname = await this.promptOAuthNicknameChoice(providerLabel);
            }
            if (selectedNickname) {
                await updateAuthNickname(selectedNickname);
                try {
                    await this.core?.networkManager?.updateUserData?.({ nickname: selectedNickname });
                } catch (e) {}
                try {
                    if (this.core?.networkManager?.userData) {
                        this.core.networkManager.userData.nickname = selectedNickname;
                    }
                } catch (e) {}
                this.updateAccount();
                this.updateAccountButton();
            }

            if (pendingProvider === "discord") {
                const shouldOpenInvite = confirm(this.t("dialog.discordJoinPrompt"));
                if (shouldOpenInvite) {
                    window.open("https://discord.gg/YAEG9qJGMh", "_blank", "noopener,noreferrer");
                }
            }
        } catch (error) {
            alert(this.t("error.discordLoginFailed", { message: error?.message || "Unknown error" }));
        } finally {
            this.discordOnboardingInProgress = false;
        }
    }

    async updateAccount () {
        const MAX_LEVEL = 40;
        const networkManager = this.core?.networkManager;

        // Default values in case userData is null or incomplete
        const defaultUserData = {
            discord: { username: "quest" },
            progression: { level: 1, xp: 0 },
            skins: { equipped: null, unlocked: [] },
            statistics: { highscore: 0, playtime: 0, kills: 0 }
        };

        // Helper function to ensure properties exist and are correctly initialized
        const ensureProperty = (obj, path, defaultValue) => {
            const keys = path.split('.');
            let current = obj;

            // Traverse the path and ensure the properties exist
            for (let key of keys) {
                if (!current[key]) {
                    current[key] = key === keys[keys.length - 1] ? defaultValue : {};
                }
                current = current[key];
            }
            return current;
        };

        // Get userData, falling back to defaultUserData if it's missing or null
        const userData = networkManager?.userData || defaultUserData;

        // Ensure all necessary properties are initialized
        ensureProperty(userData, 'discord', { username: 'quest' });
        ensureProperty(userData, 'progression', { level: 1, xp: 0 });
        ensureProperty(userData, 'skins', { equipped: null, unlocked: [] });
        ensureProperty(userData, 'statistics', { highscore: 0, playtime: 0, kills: 0 });

        // Ensure progression values are valid numbers
        if (typeof userData.progression.level !== 'number') {
            userData.progression.level = 1;
        }
        if (typeof userData.progression.xp !== 'number') {
            userData.progression.xp = 0;
        }

        // Ensure skins.unlocked is an array
        if (!Array.isArray(userData.skins.unlocked)) {
            userData.skins.unlocked = [];
        }

        // Update the username
        const username = userData.nickname || userData.discord?.username || 'Unknown User';
        this.DOM.account.handle.textContent = `@${username}`;
        if (userData.nickname) {
            this.DOM.account.handle.style.color = "#32CD32"; // Lime green for logged in users
        } else {
            this.DOM.account.handle.style.color = ""; // Default color for guests
        }

        // Update player name input based on login status
        const isLoggedIn = Boolean(networkManager?.loggedIn);
        if (isLoggedIn && userData.nickname) {
            const displayName = this.core?.networkManager?.applyOwnerTagToName?.(userData.nickname) || userData.nickname;
            // Hide input and show nickname
            this.DOM.menu.playerNameInput.value = displayName;
            localStorage.setItem("playerName", displayName);
            this.DOM.menu.playerNameInput.style.display = 'none';
            this.DOM.menu.loggedInNickname.style.display = 'block';
            this.DOM.menu.loggedInNickname.textContent = `Playing as: ${displayName}`;
        } else {
            // Show input and hide nickname
            this.DOM.menu.playerNameInput.style.display = 'block';
            this.DOM.menu.loggedInNickname.style.display = 'none';
        }

        // Handle progression data safely
        let level = userData.progression?.level || 1;
        let userXP = userData.progression?.xp || 0;

        // Cap the level and XP at MAX_LEVEL
        if (level > MAX_LEVEL) {
            level = MAX_LEVEL;
            userXP = 0; // Ensure XP doesn't exceed when max level is reached
        }

        const requiredXP = level < MAX_LEVEL ? calculateRequiredXP(level) : 0;
        const progressBarColor = getColorForLevel(level);
        const progressPercentage = level < MAX_LEVEL ? Math.max(10, requiredXP ? (userXP / requiredXP) * 100 : 0) : 100;

        this.DOM.account.progression.progressIcon.textContent = level;
        this.DOM.account.progression.progressIcon.style.backgroundColor = progressBarColor;
        this.DOM.account.progression.progressText.textContent =
            level < MAX_LEVEL ? `${userXP} / ${requiredXP} XP` : `Max Level`;
        this.DOM.account.progression.progressBar.style.width = `${progressPercentage}%`;
        this.DOM.account.progression.progressBar.style.backgroundColor = progressBarColor;

        // Keep the existing skin carousel DOM intact; only refresh its data/state.
        if (this.DOM?.skins?.previewButton) {
            this.updateSkinCircle();
        }

        // Clear previous stats
        this.DOM.account.statsContainer.innerHTML = '';

        // Format playtime from seconds
        const formatPlaytime = (playtimeInSeconds) => {
            if (!playtimeInSeconds) return "0m";
            const hours = Math.floor(playtimeInSeconds / 3600);
            const minutes = Math.floor((playtimeInSeconds % 3600) / 60);
            return `${hours}h ${minutes}m`;
        };

        const formatScore = (score) => {
            if (score >= 1_000_000) {
                return (score / 1_000_000).toFixed(2).replace(/\.00$/, '') + 'M';
            } else if (score >= 1_000) {
                return (score / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
            }
            return score.toString();
        };

        // Create and append stats dynamically
        const statsData = [
            { label: this.t("stats.highscore"), value: formatScore(userData.statistics?.highscore) || "0" },
            { label: this.t("stats.playtime"), value: formatPlaytime(userData.statistics?.playtime) },
            { label: this.t("stats.xp"), value: level < MAX_LEVEL ? `${userXP} / ${requiredXP}` : this.t("stats.maxLevel") },
            { label: this.t("stats.totalKills"), value: userData.statistics?.kills || "0" }
        ];

        statsData.forEach(stat => {
            const statDiv = document.createElement('div');

            const label = document.createElement('p');
            label.textContent = `${stat.label}:`;
            statDiv.appendChild(label);

            const value = document.createElement('p');
            value.textContent = stat.value;
            statDiv.appendChild(value);

            this.DOM.account.statsContainer.appendChild(statDiv);
        });
    }

    updateAccountButton () {
        if (this.isExternalAuthDisabled()) {
            const accountButtonsContainer = document.querySelector(".account-buttons");
            if (accountButtonsContainer) {
                accountButtonsContainer.style.display = "none";
                accountButtonsContainer.setAttribute("aria-hidden", "true");
            }
            if (this.DOM?.account?.accountButton) this.DOM.account.accountButton.style.display = "none";
            if (this.DOM?.account?.signupButton) this.DOM.account.signupButton.style.display = "none";
            const myProfileButton = document.getElementById("my-profile-button");
            if (myProfileButton) myProfileButton.style.display = "none";
            return;
        }

        const ensureMyProfileButton = () => {
            const accountButtonsContainer = document.querySelector(".account-buttons");
            if (!accountButtonsContainer) return null;

            let btn = document.getElementById("my-profile-button");
            if (!btn) {
                btn = document.createElement("button");
                btn.id = "my-profile-button";
                btn.type = "button";
                btn.textContent = this.t("menu.myProfile");
                btn.style.display = "none";
                btn.style.background = "rgba(20, 10, 40, 0.7)";
                btn.style.border = "1px solid rgba(180, 160, 255, 0.3)";
                btn.style.color = "#e0d6ff";
                btn.style.borderRadius = "10px";
                btn.style.fontSize = "13px";
                btn.style.fontWeight = "700";
                btn.style.padding = "10px 12px";
                btn.style.cursor = "pointer";
                btn.style.flex = "1";
                btn.style.whiteSpace = "nowrap";
                btn.addEventListener("click", () => this.showMyProfilePanel(true));
                accountButtonsContainer.insertBefore(btn, this.DOM.account.accountButton || null);
            }
            return btn;
        };

        const myProfileButton = ensureMyProfileButton();
        if (myProfileButton) myProfileButton.textContent = this.t("menu.myProfile");
        const isLoggedInNow = Boolean(this.core?.networkManager?.loggedIn);
        const accountContainer = document.getElementById("account-container");
        const accountDividers = accountContainer ? Array.from(accountContainer.querySelectorAll("hr")) : [];
        const discordButton = document.getElementById("discord-button");
        const shopButton = document.getElementById("shop-button");

        const applyLoggedButtonStyle = (button) => {
            if (!button) return;
            button.style.background = "rgba(20, 10, 40, 0.7)";
            button.style.border = "1px solid rgba(180, 160, 255, 0.3)";
            button.style.color = "#e0d6ff";
            button.style.borderRadius = "10px";
            button.style.fontSize = "13px";
            button.style.fontWeight = "700";
            button.style.padding = "10px 12px";
            button.style.cursor = "pointer";
            button.style.flex = "1 1 0";
            button.style.width = "0";
            button.style.whiteSpace = "nowrap";
            button.style.minHeight = "40px";
            button.style.display = "flex";
            button.style.alignItems = "center";
            button.style.justifyContent = "center";
            button.style.transform = "none";
            button.style.marginTop = "0";
            button.style.boxSizing = "border-box";
        };

        if (this.DOM.account.accountButton) {
            // Always re-bind current DOM node action (defensive against node recreation).
            this.DOM.account.accountButton.onclick = () => this.handleAccountButtonClick(this.DOM.account.accountButton);
            // Keep both buttons visually matched when My Profile is present.
            applyLoggedButtonStyle(this.DOM.account.accountButton);
            if (isLoggedInNow) {
                // Clear any existing classes before setting the "Logout" state
                this.DOM.account.accountButton.classList.remove("login");
                this.DOM.account.accountButton.textContent = this.t("menu.logout");
                this.DOM.account.accountButton.dataset.authAction = "logout";
                if (myProfileButton) {
                    applyLoggedButtonStyle(myProfileButton);
                    myProfileButton.style.display = "flex";
                }
                // Hide signup button when logged in
                if (this.DOM.account.signupButton) {
                    this.DOM.account.signupButton.style.display = "none";
                }
                if (discordButton) discordButton.style.display = "none";
                if (shopButton) shopButton.style.display = "none";
                accountDividers.forEach((hr) => { hr.style.display = "none"; });
                this.maybeHandlePendingSocialOnboarding();
            } else {
                this.DOM.account.accountButton.classList.remove("login");
                this.DOM.account.accountButton.textContent = this.t("menu.login");
                this.DOM.account.accountButton.dataset.authAction = "login";
                // Keep same visual language as My Profile/Logout while logged out.
                applyLoggedButtonStyle(this.DOM.account.accountButton);
                if (myProfileButton) myProfileButton.style.display = "none";
                // Show signup button when not logged in
                if (this.DOM.account.signupButton) {
                    applyLoggedButtonStyle(this.DOM.account.signupButton);
                    this.DOM.account.signupButton.textContent = this.t("menu.signUp");
                    this.DOM.account.signupButton.style.display = "flex";
                    this.DOM.account.signupButton.style.alignItems = "center";
                    this.DOM.account.signupButton.style.justifyContent = "center";
                }
                // Guest view stays clean/minimal.
                if (discordButton) discordButton.style.display = "none";
                if (shopButton) shopButton.style.display = "none";
                accountDividers.forEach((hr) => { hr.style.display = "none"; });
            }
            this.DOM.account.accountButton.style.display = "flex";
        }

        // Refresh global rank when auth state changes (startup/login/logout),
        // because the first fetch may happen before the session/user data is ready.
        if (this._lastGlobalRankLoginState !== isLoggedInNow) {
            this._lastGlobalRankLoginState = isLoggedInNow;
            this._populateGlobalLeaderboard();
            if (isLoggedInNow) {
                this.loadHudConfigFromAccount();
            }
        }

        // Main account card stays minimal; detailed stats live in My Profile.
        if (this.DOM?.account?.statsContainer) {
            this.DOM.account.statsContainer.style.display = "none";
        }
        const accountProgress = document.getElementById("level-progression");
        if (accountProgress) {
            accountProgress.style.display = "none";
        }
        // Also update the account display
        this.updateAccount();
    }

    showMyProfilePanel (show) {
        if (!show) {
            if (this.profilePanelElement?.parentNode) {
                this.profilePanelElement.parentNode.removeChild(this.profilePanelElement);
            }
            this.profilePanelElement = null;
            return;
        }

        this.showMyProfilePanel(false);

        const userData = this.core?.networkManager?.userData || {};
        const stats = userData.statistics || {};
        const progression = userData.progression || {};
        const nickname = userData.nickname || userData.discord?.username || "Guest";

        const formatPlaytime = (seconds) => {
            const total = Math.max(0, Number(seconds || 0));
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };
        const formatScore = (score) => {
            const n = Math.max(0, Number(score || 0));
            if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
            if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
            return String(n);
        };

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0, 0, 0, 0.45)";
        overlay.style.zIndex = "20040";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";

        const card = document.createElement("div");
        card.style.width = "min(420px, 92vw)";
        card.style.background = "rgba(20, 10, 40, 0.92)";
        card.style.border = "1px solid rgba(180, 160, 255, 0.35)";
        card.style.borderRadius = "14px";
        card.style.boxShadow = "0 14px 36px rgba(0,0,0,0.45), 0 0 18px rgba(180,160,255,0.14)";
        card.style.backdropFilter = "blur(10px)";
        card.style.padding = "16px";
        card.style.color = "#e0d6ff";
        card.style.fontFamily = "'Segoe UI', sans-serif";

        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.justifyContent = "space-between";
        header.style.marginBottom = "10px";

        const title = document.createElement("div");
        title.textContent = this.t("profile.title");
        title.style.fontSize = "20px";
        title.style.fontWeight = "900";
        title.style.color = "#9fe8ff";

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "x";
        closeBtn.style.background = "rgba(180, 160, 255, 0.14)";
        closeBtn.style.border = "1px solid rgba(180, 160, 255, 0.22)";
        closeBtn.style.color = "#e0d6ff";
        closeBtn.style.borderRadius = "8px";
        closeBtn.style.width = "30px";
        closeBtn.style.height = "30px";
        closeBtn.style.cursor = "pointer";
        closeBtn.addEventListener("click", () => this.showMyProfilePanel(false));

        header.appendChild(title);
        header.appendChild(closeBtn);

        const subtitle = document.createElement("div");
        subtitle.textContent = `@${nickname}`;
        subtitle.style.color = "#b4a0ff";
        subtitle.style.fontWeight = "700";
        subtitle.style.marginBottom = "12px";

        const profileLevel = Math.max(1, Number(progression.level || 1));
        const maxLevel = 40;
        const requiredXP = profileLevel < maxLevel ? calculateRequiredXP(profileLevel) : 0;
        const currentXP = Math.max(0, Number(progression.xp || 0));
        const progressPct = profileLevel < maxLevel && requiredXP > 0
            ? Math.max(4, Math.min(100, (currentXP / requiredXP) * 100))
            : 100;

        const xpPanel = document.createElement("div");
        xpPanel.style.marginBottom = "12px";
        xpPanel.style.padding = "10px";
        xpPanel.style.border = "1px solid rgba(180, 160, 255, 0.18)";
        xpPanel.style.borderRadius = "10px";
        xpPanel.style.background = "rgba(255,255,255,0.03)";

        const xpTop = document.createElement("div");
        xpTop.style.display = "flex";
        xpTop.style.justifyContent = "space-between";
        xpTop.style.alignItems = "center";
        xpTop.style.gap = "8px";

        const xpLabel = document.createElement("div");
        xpLabel.textContent = `Level ${profileLevel}`;
        xpLabel.style.fontWeight = "800";
        xpLabel.style.color = "#eaf6ff";

        const xpValue = document.createElement("div");
        xpValue.textContent = profileLevel < maxLevel ? `${currentXP} / ${requiredXP} XP` : "Max Level";
        xpValue.style.fontSize = "12px";
        xpValue.style.color = "#bdb2df";

        const xpBarWrap = document.createElement("div");
        xpBarWrap.style.marginTop = "8px";
        xpBarWrap.style.height = "10px";
        xpBarWrap.style.borderRadius = "999px";
        xpBarWrap.style.background = "rgba(180,160,255,0.14)";
        xpBarWrap.style.border = "1px solid rgba(180,160,255,0.14)";
        xpBarWrap.style.overflow = "hidden";

        const xpBar = document.createElement("div");
        xpBar.style.height = "100%";
        xpBar.style.width = `${progressPct}%`;
        xpBar.style.background = "linear-gradient(90deg, rgba(97,176,255,0.95), rgba(180,160,255,0.95))";
        xpBar.style.boxShadow = "0 0 10px rgba(120,180,255,0.35)";

        xpTop.appendChild(xpLabel);
        xpTop.appendChild(xpValue);
        xpBarWrap.appendChild(xpBar);
        xpPanel.appendChild(xpTop);
        xpPanel.appendChild(xpBarWrap);

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "1fr 1fr";
        grid.style.gap = "8px";

        const rows = [
            [this.t("stats.highscore"), formatScore(stats.highscore)],
            [this.t("stats.playtime"), formatPlaytime(stats.playtime)],
            [this.t("stats.xp"), `${Number(progression.xp || 0)} / ${calculateRequiredXP(Math.max(1, Number(progression.level || 1)))}`],
            [this.t("stats.totalKills"), Number(stats.kills || 0).toLocaleString(this.languageManager.getLanguage())]
        ];

        rows.forEach(([label, value]) => {
            const item = document.createElement("div");
            item.style.padding = "10px";
            item.style.border = "1px solid rgba(180, 160, 255, 0.18)";
            item.style.borderRadius = "10px";
            item.style.background = "rgba(255,255,255,0.03)";

            const l = document.createElement("div");
            l.textContent = label;
            l.style.fontSize = "12px";
            l.style.color = "#bdb2df";
            l.style.marginBottom = "4px";

            const v = document.createElement("div");
            v.textContent = value;
            v.style.fontSize = "15px";
            v.style.fontWeight = "800";
            v.style.color = "#eaf6ff";

            item.appendChild(l);
            item.appendChild(v);
            grid.appendChild(item);
        });

        const actions = document.createElement("div");
        actions.style.display = "flex";
        actions.style.gap = "10px";
        actions.style.marginTop = "14px";
        actions.style.flexWrap = "wrap";

        const mkBtn = (label, onClick, bg, border) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = label;
            btn.style.flex = "1";
            btn.style.padding = "10px 12px";
            btn.style.borderRadius = "10px";
            btn.style.border = border;
            btn.style.background = bg;
            btn.style.color = "#eaf6ff";
            btn.style.fontWeight = "700";
            btn.style.cursor = "pointer";
            btn.addEventListener("click", onClick);
            return btn;
        };

        const discordBtn = mkBtn(
            "Discord",
            () => document.getElementById("discord-button")?.click(),
            "rgba(88, 101, 242, 0.28)",
            "1px solid rgba(120, 130, 255, 0.45)"
        );
        const shopBtn = mkBtn(
            "Shop",
            () => document.getElementById("shop-button")?.click(),
            "rgba(46, 204, 113, 0.22)",
            "1px solid rgba(66, 220, 126, 0.4)"
        );
        const hudEditBtn = mkBtn(
            "Editar HUD",
            () => {
                this.showMyProfilePanel(false);
                this.startHudEditSession();
            },
            "rgba(96, 234, 255, 0.14)",
            "1px solid rgba(96, 234, 255, 0.35)"
        );

        const footer = document.createElement("div");
        footer.style.display = "flex";
        footer.style.justifyContent = "flex-end";
        footer.style.marginTop = "12px";

        const closeFooter = mkBtn(
            "Close",
            () => this.showMyProfilePanel(false),
            "rgba(180, 160, 255, 0.12)",
            "1px solid rgba(180, 160, 255, 0.25)"
        );
        closeFooter.style.flex = "0 0 auto";
        closeFooter.style.minWidth = "110px";

        actions.appendChild(discordBtn);
        actions.appendChild(shopBtn);
        actions.appendChild(hudEditBtn);

        // Safety cleanup for stale cached builds/UI: remove any legacy "Config" button if present.
        Array.from(actions.querySelectorAll("button")).forEach((btn) => {
            if ((btn.textContent || "").trim().toLowerCase() === "config") {
                btn.remove();
            }
        });
        footer.appendChild(closeFooter);

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) this.showMyProfilePanel(false);
        });

        card.appendChild(header);
        card.appendChild(subtitle);
        card.appendChild(xpPanel);
        card.appendChild(grid);
        card.appendChild(actions);
        card.appendChild(footer);
        overlay.appendChild(card);

        document.body.appendChild(overlay);
        this.profilePanelElement = overlay;
    }

    getNeutralSkinPreviewDataUrl() {
        const nonSkinPalette = [
            "#60eaff", "#c0d7f6", "#61b0ff", "#ae97f6", "#61ffb0",
            "#a6ff60", "#a1cd84", "#3fc6a8", "#fff070", "#ffb061",
            "#d88166", "#ff794f", "#ff605f", "#f697b0", "#ff6ef1"
        ];
        const storedIndex = Number(localStorage.getItem("defaultColorIndex")) || 0;
        const safeIndex = Math.max(0, Math.min(nonSkinPalette.length - 1, storedIndex));
        const neutralColor = nonSkinPalette[safeIndex];

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="g" cx="35%" cy="30%" r="75%">
      <stop offset="0%" stop-color="${neutralColor}"/>
      <stop offset="72%" stop-color="${neutralColor}"/>
      <stop offset="100%" stop-color="#2f3444"/>
    </radialGradient>
  </defs>
  <circle cx="64" cy="64" r="60" fill="url(#g)" stroke="#7f8799" stroke-width="4"/>
  <circle cx="64" cy="64" r="22" fill="none" stroke="#dbe4ff" stroke-width="5" opacity="0.9"/>
  <circle cx="64" cy="64" r="8" fill="#dbe4ff" opacity="0.95"/>
</svg>`;
        return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }

    getDefaultPaletteColor() {
        const nonSkinPalette = this.getNonSkinPalette();
        const storedIndex = Number(localStorage.getItem("defaultColorIndex")) || 0;
        const safeIndex = Math.max(0, Math.min(nonSkinPalette.length - 1, storedIndex));
        return nonSkinPalette[safeIndex];
    }

    getNonSkinPalette() {
        return [
            "#60eaff", "#c0d7f6", "#61b0ff", "#ae97f6", "#61ffb0",
            "#a6ff60", "#a1cd84", "#3fc6a8", "#fff070", "#ffb061",
            "#d88166", "#ff794f", "#ff605f", "#f697b0", "#ff6ef1"
        ];
    }

    getNearestPaletteIndex(hexColor) {
        if (!hexColor || typeof hexColor !== "string") return 0;
        const normalized = /^#[0-9a-fA-F]{6}$/.test(hexColor) ? hexColor : null;
        if (!normalized) return 0;

        const toRgb = (hex) => ({
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16),
        });

        const target = toRgb(normalized);
        const palette = this.getNonSkinPalette();

        let bestIndex = 0;
        let bestDistance = Infinity;

        for (let i = 0; i < palette.length; i++) {
            const p = toRgb(palette[i]);
            const dr = target.r - p.r;
            const dg = target.g - p.g;
            const db = target.b - p.b;
            const distance = dr * dr + dg * dg + db * db;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    async updateToolbarAccentForSkin(currentSkin) {
        let accent = this.getDefaultPaletteColor();

        if (currentSkin && currentSkin.name && currentSkin.name !== "Default") {
            try {
                const mapped = this.getMappedSkinAccent(currentSkin.name);
                if (mapped) {
                    accent = mapped;
                }
                if (!mapped) {
                    let cached = null;

                    // 1) Prefer numeric ID path (works for default/veteran/premium and Supabase IDs).
                    const numericId = Number(currentSkin.numericId ?? currentSkin.id);
                    if (Number.isFinite(numericId) && numericId > 0) {
                        cached = await SkinCache.getSkinById(numericId);
                    }

                    // 2) Fallback to name lookup (mainly Supabase skins by name).
                    if (!cached?.image && currentSkin.name) {
                        cached = await SkinCache.getSkinByName(currentSkin.name);
                    }

                    // 3) Final fallback: deterministic accent by skin name, so it never snaps to blue.
                    if (cached?.image) {
                        const extracted = this.extractDominantColorFromImage(cached.image);
                        if (extracted) {
                            accent = extracted;
                        } else {
                            accent = this.getHashedFallbackAccent(currentSkin.name);
                        }
                    } else {
                        accent = this.getHashedFallbackAccent(currentSkin.name);
                    }
                }
            } catch (error) {
                console.warn("Failed to derive accent color from skin image:", error);
                accent = this.getHashedFallbackAccent(currentSkin.name);
            }
        }

        // Always quantize to server palette so toolbar and placed entities stay identical.
        const resolved = this.applyServerPaletteColor(accent);
        localStorage.setItem("toolbarAccentColor", resolved);
        if (this.core?.toolbar) {
            this.core.toolbar.changeColor(resolved);
        }
    }

    applyServerPaletteColor(accent) {
        const palette = this.getNonSkinPalette();
        const nearest = this.getNearestPaletteIndex(accent);
        const safeIndex = Math.max(0, Math.min(palette.length - 1, nearest));
        const resolved = palette[safeIndex] || this.getDefaultPaletteColor();

        localStorage.setItem("defaultColorIndex", String(safeIndex));

        // Keep local prediction color aligned with server palette before first snapshots arrive.
        if (this.core?.gameManager?.player) {
            this.core.gameManager.player.color = resolved;
        }

        return resolved;
    }

    normalizeSkinKey(name) {
        if (!name || typeof name !== "string") return "";
        return name
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]+/g, "");
    }

    getMappedSkinAccent(name) {
        const key = this.normalizeSkinKey(name);
        if (!key) return null;

        const byName = {
            default: "#60eaff",
            alemanha: "#f2d23b",
            germany: "#f2d23b",
            arabiasaudita: "#2dbd4f",
            saudiarabia: "#2dbd4f",
            argentina: "#74c6ff",
            armenia: "#e45757",
            belgica: "#f0cd45",
            belgium: "#f0cd45",
            bola8: "#d9d9d9",
            eightball: "#d9d9d9",
            brazil: "#35b84f",
            brasil: "#35b84f",
            canada: "#ff5a66",
            catar: "#8d315a",
            qatar: "#8d315a",
            chile: "#4c67d9",
            china: "#ff4a57",
            coreiadosul: "#4c67d9",
            southkorea: "#4c67d9",
            eua: "#d94a57",
            usa: "#d94a57",
            franca: "#4c67d9",
            france: "#4c67d9",
            futebol: "#f2f2f2",
            football: "#f2f2f2",
            hamburger: "#d89045",
            hamburguer: "#d89045",
            iraque: "#43b855",
            iraq: "#43b855",
            irlanda: "#4ecf63",
            ireland: "#4ecf63",
            italia: "#4ecf63",
            italy: "#4ecf63",
            japao: "#f35a6a",
            japan: "#f35a6a",
            lituania: "#e8cd4b",
            lithuania: "#e8cd4b",
            luxemburgo: "#6ec7ff",
            luxembourg: "#6ec7ff",
            monaco: "#e25662",
            olho: "#83c157",
            eye: "#83c157",
            reinounido: "#5c6fe2",
            unitedkingdom: "#5c6fe2",
            uk: "#5c6fe2",
            russia: "#5f74e0",
            sucia: "#5f74e0",
            sweden: "#5f74e0",
            suica: "#f25c66",
            switzerland: "#f25c66",
            turquia: "#e44856",
            turkey: "#e44856",
            ucrania: "#5d84ff",
            ukraine: "#5d84ff",
            unicornio: "#ff8fcf",
            unicorn: "#ff8fcf",
            gd: "#cab6a4",
            ussr: "#d64b74",
            israel: "#4f7ddf",
            trump: "#f05b4f",
            putin: "#4f7ddf",
            fly: "#c68b5d",
            spider: "#ffe624",
            goldfish: "#34d6ff",
            jellyfish: "#d85df7",
            frog: "#68cb4d",
            wizard: "#4f7ddf",
            penguin: "#84b7f3",
            void: "#6f6677",
            ratking: "#a4815f",
        };

        return byName[key] || null;
    }

    getHashedFallbackAccent(name) {
        const palette = [
            "#43c044", "#ffd338", "#f85b5b", "#4bb6ff", "#9d7dff",
            "#ff8f3d", "#38d9c1", "#ff6ac1", "#8fd14f", "#d18d4a"
        ];
        if (!name || typeof name !== "string") {
            return this.getDefaultPaletteColor();
        }
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
        }
        return palette[hash % palette.length];
    }

    extractDominantColorFromImage(image) {
        try {
            if (!image || !image.naturalWidth || !image.naturalHeight) return null;
            const size = 40;
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) return null;

            ctx.drawImage(image, 0, 0, size, size);
            const data = ctx.getImageData(0, 0, size, size).data;
            const buckets = new Map();

            for (let i = 0; i < data.length; i += 4) {
                const alpha = data[i + 3];
                if (alpha < 100) continue;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];

                const { s, v } = this.rgbToHsv(r, g, b);
                // Ignore gray-ish/washed pixels and almost black/white pixels.
                if (s < 0.22 || v < 0.18 || v > 0.97) continue;

                const qr = Math.round(r / 24) * 24;
                const qg = Math.round(g / 24) * 24;
                const qb = Math.round(b / 24) * 24;
                const key = `${qr},${qg},${qb}`;

                const weight = (0.35 + s * 0.9 + v * 0.25);
                buckets.set(key, (buckets.get(key) || 0) + weight);
            }

            if (!buckets.size) return null;

            let bestKey = null;
            let bestScore = -1;
            for (const [key, score] of buckets.entries()) {
                if (score > bestScore) {
                    bestScore = score;
                    bestKey = key;
                }
            }

            if (!bestKey) return null;
            const [r, g, b] = bestKey.split(",").map((n) => Number(n));
            const tuned = this.tuneAccentColor(r, g, b);

            return `#${[tuned.r, tuned.g, tuned.b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        } catch {
            return null;
        }
    }

    rgbToHsv(r, g, b) {
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const delta = max - min;

        let h = 0;
        const s = max === 0 ? 0 : delta / max;
        const v = max;

        if (delta !== 0) {
            if (max === rn) h = ((gn - bn) / delta) % 6;
            else if (max === gn) h = (bn - rn) / delta + 2;
            else h = (rn - gn) / delta + 4;
            h *= 60;
            if (h < 0) h += 360;
        }

        return { h, s, v };
    }

    hsvToRgb(h, s, v) {
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        let rp = 0, gp = 0, bp = 0;

        if (h < 60) [rp, gp, bp] = [c, x, 0];
        else if (h < 120) [rp, gp, bp] = [x, c, 0];
        else if (h < 180) [rp, gp, bp] = [0, c, x];
        else if (h < 240) [rp, gp, bp] = [0, x, c];
        else if (h < 300) [rp, gp, bp] = [x, 0, c];
        else [rp, gp, bp] = [c, 0, x];

        return {
            r: Math.round((rp + m) * 255),
            g: Math.round((gp + m) * 255),
            b: Math.round((bp + m) * 255)
        };
    }

    tuneAccentColor(r, g, b) {
        const hsv = this.rgbToHsv(r, g, b);
        const tunedS = Math.max(0.45, hsv.s);
        const tunedV = Math.max(0.52, Math.min(0.9, hsv.v));
        return this.hsvToRgb(hsv.h, tunedS, tunedV);
    }

    async updateSkinCircle() {
        const circle = document.getElementById('skin-preview-circle');
        let img = document.getElementById('current-skin-img');
        let nameDisplay = document.getElementById('skin-name-display');
        const prevBtn = document.getElementById('skin-carousel-prev-menu');
        const nextBtn = document.getElementById('skin-carousel-next-menu');
        
        if (!circle) {
            return; // Elements not ready yet
        }

        // Self-heal preview structure in case another UI flow replaced circle.innerHTML.
        if (!img) {
            img = document.createElement('img');
            img.id = 'current-skin-img';
            img.alt = 'Skin';
            img.style.display = 'none';
            circle.appendChild(img);
        }
        if (!nameDisplay) {
            nameDisplay = document.createElement('p');
            nameDisplay.id = 'skin-name-display';
            nameDisplay.textContent = 'Default';
            circle.appendChild(nameDisplay);
        }
        
        const currentSkin = this.availableSkins[this.currentSkinIndex];
        
        if (currentSkin) {
            nameDisplay.textContent = '';
            nameDisplay.style.display = 'none';
            
            if (currentSkin.url) {
                img.src = currentSkin.url;
                img.style.display = 'block';
            } else if (currentSkin.name && currentSkin.name !== 'Default') {
                try {
                    const cached = await SkinCache.getSkinByName(currentSkin.name);
                    if (cached?.url) {
                        img.src = cached.url;
                        img.style.display = 'block';
                    } else if (cached?.image?.src) {
                        img.src = cached.image.src;
                        img.style.display = 'block';
                    } else {
                        img.style.display = 'none';
                    }
                } catch (error) {
                    console.warn('Failed to load skin preview image:', error);
                    img.style.display = 'none';
                }
            } else {
                // Default/no-skin must still show a neutral preview icon.
                if (!localStorage.getItem("defaultColorIndex")) {
                    localStorage.setItem("defaultColorIndex", "0");
                }
                img.src = this.getNeutralSkinPreviewDataUrl();
                img.style.display = 'block';
            }
        }
        
        // Keep nav buttons interactive; carousel is circular.
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        
        // Update Use button state
        this.updateUseButton();
        this.bindSkinNavButtons();
    }
    
    updateUseButton() {
        const useBtn = document.getElementById('skin-use-button');
        if (!useBtn) return;

        // Auto-equip flow: keep button hidden.
        useBtn.style.display = 'none';

        const currentSkin = this.availableSkins[this.currentSkinIndex];
        const dbSelected = this.core?.networkManager?.userData?.selected_skin ?? null;
        const localSelected = localStorage.getItem('equippedSkinName') || '';
        const equippedName = dbSelected ?? localSelected;

        const currentName = currentSkin?.name === 'Default' ? '' : (currentSkin?.name || '');
        const isEquipped = currentName === equippedName;

        useBtn.textContent = isEquipped ? 'Equipped' : 'Use';
        useBtn.classList.toggle('selected', isEquipped);
        useBtn.disabled = isEquipped;
    }

    addSkinNavigationListeners() {
        this.bindSkinNavButtons();
    }

    async goPrevSkin(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const total = this.availableSkins.length;
        if (total <= 1) return;
        this.currentSkinIndex = (this.currentSkinIndex - 1 + total) % total;
        await this.selectCurrentSkin({ persistRemote: true, refreshLibrary: false });
    }

    async goNextSkin(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const total = this.availableSkins.length;
        if (total <= 1) return;
        this.currentSkinIndex = (this.currentSkinIndex + 1) % total;
        await this.selectCurrentSkin({ persistRemote: true, refreshLibrary: false });
    }

    bindSkinNavButtons() {
        const prevBtn = document.getElementById('skin-carousel-prev-menu');
        const nextBtn = document.getElementById('skin-carousel-next-menu');

        if (prevBtn && !prevBtn.dataset.boundNav) {
            prevBtn.addEventListener('click', (e) => this.goPrevSkin(e));
            prevBtn.dataset.boundNav = '1';
        }

        if (nextBtn && !nextBtn.dataset.boundNav) {
            nextBtn.addEventListener('click', (e) => this.goNextSkin(e));
            nextBtn.dataset.boundNav = '1';
        }
    }

    applySelectedSkinToLocalPlayer(currentSkin) {
        const player = this.core?.gameManager?.player;
        if (!player) return;

        if (!currentSkin || currentSkin.name === 'Default') {
            player.skinID = null;
            player.skin = null;
            player.skinLoaded = false;
            return;
        }

        player.skinID = currentSkin.name;
        player.skinLoadAttempts = 0;
        player._loadSkin(currentSkin.name);
    }
    
    addSkinUseButtonListener() {
        const useBtn = document.getElementById('skin-use-button');
        if (useBtn) {
            useBtn.addEventListener('click', () => {
                this.selectCurrentSkin();
            });
        }
    }
    
    async selectCurrentSkin(options = {}) {
        const { persistRemote = true, refreshLibrary = true } = options;
        const currentSkin = this.availableSkins[this.currentSkinIndex];
        if (!currentSkin) return;
        const networkManager = this.core && this.core.networkManager;
        
        const skinName = currentSkin.name === 'Default' ? null : currentSkin.name;
        const rawSkinNumeric = currentSkin.numericId ?? currentSkin.id ?? 0;
        const skinNumeric = Number(rawSkinNumeric) || 0;

        // Save to localStorage (name for DB/UI, numeric for network byte)
        localStorage.setItem('equippedSkin', skinNumeric);
        localStorage.setItem('equippedSkinName', skinName || '');
        
        console.log('Skin equipped:', skinName);

        // Update UI immediately
        this.updateSkinCircle();
        this.updateUseButton();
        this.updateAccount();
        this.applySelectedSkinToLocalPlayer(currentSkin);
        await this.updateToolbarAccentForSkin(currentSkin);
        
        // If logged in, save to database
        const isLoggedIn = Boolean(networkManager && networkManager.loggedIn);
        const userId = networkManager ? networkManager.userId : null;
        
        if (persistRemote && isLoggedIn && userId) {
            if (this.skinPersistTimeout) {
                clearTimeout(this.skinPersistTimeout);
            }
            this.skinPersistTimeout = setTimeout(async () => {
                try {
                    await updateSelectedSkin(userId, skinName);
                    console.log('Skin saved to database');
                    if (networkManager && networkManager.userData) {
                        networkManager.userData.selected_skin = skinName;
                        if (networkManager.userData.skins) {
                            networkManager.userData.skins.equipped = skinNumeric;
                        }
                    }
                } catch (error) {
                    console.error('Error saving skin to database:', error);
                }
            }, 250);
        }
        
        // Update library if open
        if (refreshLibrary) {
            this.populateSkinLibrary();
        }
    }
    
    addSkinCircleClickListener() {
        const circle = document.getElementById('skin-preview-circle');
        if (circle) {
            circle.addEventListener('click', () => {
                // Populate skins before showing dialog
                this.populateSkinLibrary();
                this.showSkinLibraryDialog(true);
            });
        }
    }
    
    populateSkinLibrary() {
        const container = document.getElementById('skin-grid-container');
        if (!container) {
            console.warn('Skin grid container not found');
            return; // Container not ready yet
        }
        
        console.log('Populating skin library with', this.availableSkins.length, 'skins');
        
        container.innerHTML = '';
        
        let currentEquippedName = localStorage.getItem('equippedSkinName') || '';
        
        this.availableSkins.forEach((skin, index) => {
            if (!skin || !skin.name) return;
            const skinCard = document.createElement('div');
            skinCard.classList.add('skin-item');
            skinCard.title = skin.name;
            skinCard.setAttribute('aria-label', skin.name);
            
            const isEquipped = (skin.name === 'Default' && (!currentEquippedName || currentEquippedName === '')) || 
                               (skin.name === currentEquippedName);
            
            if (isEquipped) {
                skinCard.classList.add('equipped');
            }
            
            if (skin.url) {
                const img = document.createElement('img');
                img.src = skin.url;
                img.alt = skin.name;
                img.loading = 'lazy';
                skinCard.appendChild(img);
            } else {
                const placeholder = document.createElement('div');
                placeholder.classList.add('skin-placeholder');
                placeholder.setAttribute('aria-hidden', 'true');
                placeholder.textContent = 'S';
                skinCard.appendChild(placeholder);
            }
            
            skinCard.addEventListener('click', async () => {
                this.currentSkinIndex = index;
                this.updateSkinCircle();
                await this.selectCurrentSkin();
                this.showSkinLibraryDialog(false); // Close dialog after selection
            });
            
            container.appendChild(skinCard);
        });
    }


    populateThemeSelect () {
        if (!this.DOM.settings.themeSelect) return;

        // Clear existing options
        this.DOM.settings.themeSelect.innerHTML = "";

        // Populate the dropdown with available themes
        Object.keys(this.core.themeManager.themeProperties).forEach(themeKey => {
            const option = document.createElement("option");
            option.value = themeKey;
            option.textContent = themeKey.charAt(0).toUpperCase() + themeKey.slice(1);
            this.DOM.settings.themeSelect.appendChild(option);
        });

        // Set the saved theme as selected
        if (this.theme) {
            this.DOM.settings.themeSelect.value = this.theme;
        }
    }

    animatePreview (previewCanvas, renderable, options = {}) {
        const context = previewCanvas.getContext("2d");
        let animationFrameId; // Store the animation frame ID
        const parsedScale = Number(options?.scale);
        const scale = Number.isFinite(parsedScale) ? Math.max(0.1, Math.min(2, parsedScale)) : 0.8;
        const parsedRotationSpeed = Number(options?.rotationSpeed);
        const rotationSpeed = Number.isFinite(parsedRotationSpeed) ? parsedRotationSpeed : 0.001;
        let lastTime = 0; // Initialize lastTime to 0

        renderable.rotationAngle = this.upgradePreviewRotation; // Initialize rotation angle for the building

        const renderFrame = (deltaTime) => {
            // Update rotation angle using deltaTime
            if (rotationSpeed !== 0) {
                this.upgradePreviewRotation += rotationSpeed;
            }
            renderable.rotationAngle = this.upgradePreviewRotation;

            // Clear the previous frame
            context.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

            // Save the current context state
            context.save();
            context.lineJoin = "round";
            context.lineCap = "round";
            // Translate context to the center of the canvas
            context.translate(previewCanvas.width / 2, previewCanvas.height / 2);

            // Rotate the context
            context.rotate(this.upgradePreviewRotation);

            // Apply the scale
            context.scale(scale, scale);

            // Translate context back to the top-left corner
            context.translate(-previewCanvas.width / 2, -previewCanvas.height / 2);

            // Render the building
            renderable.render(context, { x: -previewCanvas.width / 2, y: -previewCanvas.height / 2 }, deltaTime);

            // Restore the original context state
            context.restore();

            if (renderable?.previewBadge === "spotter-blocked") {
                // Draw badge in fixed canvas coordinates so it is always visible.
                context.save();
                const cx = previewCanvas.width - 18;
                const cy = 18;

                context.fillStyle = "#555555";
                context.strokeStyle = "#3d3d3d";
                context.lineWidth = 2;
                context.beginPath();
                context.arc(cx, cy, 7, 0, Math.PI * 2);
                context.fill();
                context.stroke();
                context.closePath();

                context.strokeStyle = "#ff2d2d";
                context.lineWidth = 3;
                context.beginPath();
                context.moveTo(cx - 6, cy - 6);
                context.lineTo(cx + 6, cy + 6);
                context.moveTo(cx + 6, cy - 6);
                context.lineTo(cx - 6, cy + 6);
                context.stroke();
                context.closePath();
                context.restore();
            }
        };

        const animate = (currentTime) => {
            // Calculate deltaTime (time difference between frames)
            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;
            renderFrame(deltaTime);
            // Request the next frame
            animationFrameId = requestAnimationFrame(animate);
        };

        // Static preview mode (no spinning) for better readability in compact keybind lists.
        if (rotationSpeed === 0) {
            renderFrame(16);
            previewCanvas.stopAnimation = () => {};
            return;
        }

        // Start animated mode
        animate(0); // Start with currentTime as 0

        // Method to stop the animation
        previewCanvas.stopAnimation = () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
            }
        };
    }

    createCloakingPreviewRenderable (baseRenderable) {
        return {
            previewBadge: "spotter-blocked",
            render: (context, camera, deltaTime) => {
                baseRenderable.render(context, camera, deltaTime);
            }
        };
    }

    createRepairPreviewRenderable () {
        let time = 0;
        return {
            render: (context, camera, deltaTime = 16) => {
                time += deltaTime;
                const t = time * 0.004;
                const cx = 40;
                const cy = 40;
                const pulse = 0.5 + (Math.sin(t * 2.2) * 0.5);

                // Back glow
                const glow = context.createRadialGradient(cx, cy, 8, cx, cy, 34);
                glow.addColorStop(0, "rgba(180, 160, 255, 0.24)");
                glow.addColorStop(1, "rgba(180, 160, 255, 0)");
                context.fillStyle = glow;
                context.beginPath();
                context.arc(cx, cy, 34, 0, Math.PI * 2);
                context.fill();

                // Core base plate (symbolizing headquarters)
                context.fillStyle = "rgba(40, 22, 72, 0.95)";
                context.strokeStyle = "rgba(180, 160, 255, 0.45)";
                context.lineWidth = 2;
                context.beginPath();
                for (let i = 0; i < 6; i++) {
                    const a = (-Math.PI / 2) + (i * Math.PI / 3);
                    const x = cx + Math.cos(a) * 17;
                    const y = cy + Math.sin(a) * 17;
                    if (i === 0) context.moveTo(x, y);
                    else context.lineTo(x, y);
                }
                context.closePath();
                context.fill();
                context.stroke();

                // Repair ring pulse
                context.strokeStyle = `rgba(110, 255, 182, ${0.22 + pulse * 0.38})`;
                context.lineWidth = 3;
                context.beginPath();
                context.arc(cx, cy, 22 + (pulse * 2.5), 0, Math.PI * 2);
                context.stroke();

                // Plus sign (repair/restore)
                context.strokeStyle = "rgba(160, 255, 214, 0.95)";
                context.lineWidth = 4;
                context.beginPath();
                context.moveTo(cx - 6, cy);
                context.lineTo(cx + 6, cy);
                context.moveTo(cx, cy - 6);
                context.lineTo(cx, cy + 6);
                context.stroke();

                // Small orbiting spark
                const sa = t * 1.8;
                const sx = cx + Math.cos(sa) * 24;
                const sy = cy + Math.sin(sa) * 24;
                context.fillStyle = "rgba(213, 255, 239, 0.95)";
                context.beginPath();
                context.arc(sx, sy, 2.2, 0, Math.PI * 2);
                context.fill();
            }
        };
    }

    createRelocateBasePreviewRenderable () {
        let time = 0;
        return {
            render: (context, camera, deltaTime = 16) => {
                time += deltaTime;
                const t = time * 0.0035;
                const pulse = 0.5 + (Math.sin(t * 2) * 0.5);

                const drawHex = (x, y, r, fill, stroke, alpha = 1) => {
                    context.save();
                    context.globalAlpha = alpha;
                    context.fillStyle = fill;
                    context.strokeStyle = stroke;
                    context.lineWidth = 2;
                    context.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const a = (-Math.PI / 2) + (i * Math.PI / 3);
                        const px = x + Math.cos(a) * r;
                        const py = y + Math.sin(a) * r;
                        if (i === 0) context.moveTo(px, py);
                        else context.lineTo(px, py);
                    }
                    context.closePath();
                    context.fill();
                    context.stroke();
                    context.restore();
                };

                // Origin / destination pads
                drawHex(26, 48, 11, "rgba(38, 22, 68, 0.95)", "rgba(180,160,255,0.35)", 0.7);
                drawHex(54, 31, 11, "rgba(46, 28, 86, 0.95)", "rgba(180,160,255,0.6)", 1);

                // Curved trajectory
                context.strokeStyle = "rgba(180, 160, 255, 0.55)";
                context.lineWidth = 2;
                context.setLineDash([4, 4]);
                context.beginPath();
                context.moveTo(29, 43);
                context.quadraticCurveTo(40, 17, 50, 34);
                context.stroke();
                context.setLineDash([]);

                // Moving relocation pulse along the curve
                const p = (t % 1);
                const x = (1 - p) * (1 - p) * 29 + 2 * (1 - p) * p * 40 + p * p * 50;
                const y = (1 - p) * (1 - p) * 43 + 2 * (1 - p) * p * 17 + p * p * 34;
                context.fillStyle = "rgba(207, 197, 255, 0.95)";
                context.beginPath();
                context.arc(x, y, 2 + (pulse * 0.8), 0, Math.PI * 2);
                context.fill();

                // Arrow head near destination
                context.strokeStyle = "rgba(180, 160, 255, 0.9)";
                context.lineWidth = 2.5;
                context.beginPath();
                context.moveTo(46, 26);
                context.lineTo(55, 30);
                context.lineTo(49, 38);
                context.stroke();
            }
        };
    }

    showCoreUpgrades (onUpgradeSelect) {
        // Inline helper to fetch available upgrades based on type
        const getAvailableUpgrades = () => {
            //! Get available upgrades for the core from constants.js

            // Test data for available upgrades
            const options = [
                {
                    name: "Commander",
                    description: "Powerful unit, you can only have 1",
                    cost: 1500,
                    unitType: UnitTypes.COMMANDER
                },
                {
                    name: "Repair",
                    description: "Repair your base and restore health.",
                    cost: 6000,
                    unitType: null // No unit type associated
                },
                {
                    name: "Relocate Base",
                    description: "Move your whole base to an empty slot.",
                    cost: 4000,
                    unitType: null
                },
            ];

            // Filter options based on the gameManager"s state
            return options.filter(option => {
                if (option.unitType === UnitTypes.COMMANDER) {
                    return !this.core.gameManager.hasCommander;
                }
                return true; // Include other options
            });
        };


        // Inline helper to create and append upgrade items to the list
        const createUpgradeItem = (upgradeInfo, index) => {
            const upgradeItem = document.createElement("div");
            upgradeItem.classList.add("upgrade-item");
            upgradeItem.dataset.upgradeName = String(upgradeInfo?.name || "");
            if (upgradeInfo?.name === "Repair") {
                // Prevent accidental 6000-power spend from hotkeys.
                upgradeItem.dataset.clickOnly = "1";
            }

            const preview = document.createElement("canvas");
            preview.classList.add("preview");
            preview.width = 80;
            preview.height = 80;

            let renderable;
            if (upgradeInfo.unitType) {
                const UnitClass = UnitManager.getUnitClassByType(upgradeInfo.unitType);
                renderable = new UnitClass(this.core.gameManager.player.color, { x: 0, y: 0 }, 0);
            } else if (upgradeInfo.name === "Repair") {
                renderable = this.createRepairPreviewRenderable();
            } else if (upgradeInfo.name === "Relocate Base") {
                renderable = this.createRelocateBasePreviewRenderable();
            }

            if (renderable) {
                this.animatePreview(preview, renderable);
            }

            const description = document.createElement("div");
            description.classList.add("description");

            description.innerHTML = `
                <p class="header">${upgradeInfo.name}</p>
                <p class="text">${upgradeInfo.description}</p>
                <p class="hotkey">[CLICK]</p>
                <p class="cost">${upgradeInfo.cost} Power</p>
            `;
            this.upgradeCostElements.push({ cost: upgradeInfo.cost, element: description.querySelector(".cost") });

            upgradeItem.appendChild(preview);
            upgradeItem.appendChild(description);

            upgradeItem.addEventListener("click", () => {
                this.tutorialActionMarks.coreUpgradeAt = Date.now();
                if (String(upgradeInfo?.name || "").toLowerCase() === "commander") {
                    this.tutorialActionMarks.commanderBuyAt = Date.now();
                }
                onUpgradeSelect(upgradeInfo);
            });

            this.DOM.game.upgrades.list.appendChild(upgradeItem);

            this._updateCost();
        };

        // Inline helper to handle "no upgrades" or "coming soon" messages
        const handleEmptyUpgrades = (availableUpgrades) => {
            if (availableUpgrades.length === 0) {
                const noUpgradesItem = document.createElement("div");
                noUpgradesItem.classList.add("upgrade-item", "coming-soon");
                noUpgradesItem.innerHTML = "<p>No upgrades available</p>";
                this.DOM.game.upgrades.list.appendChild(noUpgradesItem);
            }
        };

        // Start processing
        const availableUpgrades = getAvailableUpgrades();

        // Set the building name in the header
        document.querySelector("#upgrade-container h1").textContent = "Headquarters";

        // Stop and clear previous animations, then clear the upgrade list
        this.hideUpgrades();
        this.DOM.game.upgrades.list.innerHTML = "";
        this.DOM.game.upgrades.container.dataset.mode = "core";


        // Populate available upgrades
        availableUpgrades.forEach((upgradeInfo, index) => createUpgradeItem(upgradeInfo, index));

        // Handle cases with no or fewer upgrades than expected
        handleEmptyUpgrades(availableUpgrades);

        this.DOM.game.upgrades.destroyButton.style.display = "none";

        // Show the upgrade container
        this.DOM.game.upgrades.container.style.display = "flex";
    }

    showUpgrades (building, onUpgradeSelect, onDestroyClicked) {
        this.hideUpgrades(false);
        this.DOM.game.upgrades.list.innerHTML = "";
        this.DOM.game.upgrades.container.dataset.mode = "building";

        const oldDestroyAllButton = document.getElementById("upgrade-destroy-all-button");
        if (oldDestroyAllButton?.parentNode) {
            oldDestroyAllButton.parentNode.removeChild(oldDestroyAllButton);
        }

        // Set up destroy button
        this.DOM.game.upgrades.destroyButton.removeEventListener("click", this.destroyClickHandler);
        this.destroyClickHandler = () => {
            this.tutorialActionMarks.sellAt = Date.now();
            onDestroyClicked?.();
        };
        this.DOM.game.upgrades.destroyButton.addEventListener("click", this.destroyClickHandler);

        if (onUpgradeSelect === null) {
            // MULTIPLE BUILDING TYPES
            document.querySelector("#upgrade-container h1").textContent = this.t("game.multipleBuildings");
            
            let totalRefund = 0;
            building.buildings.forEach(b => {
                const buildingDetails = getBuildingDetails(b.type, b.variant);
                if (buildingDetails) {
                    totalRefund += Math.floor(buildingDetails.cost / 2);
                }
            });
            this.DOM.game.upgrades.destroyButton.innerHTML = `<p>${this.t("game.destroy")}</p><p class="refund-amount">+${totalRefund} Power</p>`;
            this._clearUpgradeTabsElement();

            // Show a summary of the multiple selection: total count and counts per building type
            if (this.DOM.game.upgrades.list) {
                this.DOM.game.upgrades.list.innerHTML = "";

                const countsByType = new Map();
                building.buildings.forEach(b => {
                    const details = getBuildingDetails(b.type, b.variant);
                    const name = details ? details.name : (Object.keys(BuildingTypes).find(k => BuildingTypes[k] === b.type) || this.t("game.unknown"));
                    countsByType.set(name, (countsByType.get(name) || 0) + 1);
                });

                const summary = document.createElement("div");
                summary.classList.add("multiple-selection-summary");
                const totalEl = document.createElement("p");
                totalEl.classList.add("summary-total");
                totalEl.textContent = this.t("game.totalSelected", { count: building.count });
                summary.appendChild(totalEl);

                countsByType.forEach((count, name) => {
                    const line = document.createElement("p");
                    line.classList.add("summary-line");
                    line.textContent = `${name}: ${count}`;
                    summary.appendChild(line);
                });

                this.DOM.game.upgrades.list.appendChild(summary);
            }
        } else {
            // SINGLE BUILDING TYPE
            const isArmory = BuildingTypes.ARMORY === building.type;
            const isBarracks = BuildingTypes.BARRACKS === building.type;
            const keyUpgradeAllMode = String(this.getHudKeybind("upgradeAllMode", "y") || "y").toUpperCase();
            const allCount = Number.isFinite(Number(building?.allCount))
                ? Number(building.allCount)
                : Number(building.count || 0);
            const canBulkAcrossBase = !isArmory;

            const getAvailableUpgrades = () => {
                const purchasedVariants = building.purchasedUpgrades ? Array.from(building.purchasedUpgrades) : [];
                return getAvailableBuildingUpgrades(building.type, building.variant, purchasedVariants);
            };

            const attachNextEvolutionTooltip = (upgradeItem, upgradeInfo) => {
                if (typeof upgradeInfo?.variant !== "number") return;

                const details = getBuildingDetails(building.type, upgradeInfo.variant);
                if (!details) return;

                const nextVariants = Array.isArray(details.next) ? details.next : [];
                const nextNames = nextVariants
                    .map((variant) => getBuildingDetails(building.type, variant)?.name)
                    .filter(Boolean);

                const tooltip = document.createElement("div");
                tooltip.classList.add("upgrade-next-tooltip");

                if (nextNames.length > 0) {
                    tooltip.innerHTML = `<p class="title">Next Evolutions</p>`;

                    const list = document.createElement("div");
                    list.classList.add("next-upgrade-icon-list");

                    nextVariants.forEach((variant, idx) => {
                        const nextDetails = getBuildingDetails(building.type, variant);
                        if (!nextDetails) return;

                        const item = document.createElement("div");
                        item.classList.add("next-upgrade-icon-item");

                        const canvas = document.createElement("canvas");
                        canvas.width = 56;
                        canvas.height = 56;
                        canvas.classList.add("next-upgrade-icon-canvas");

                        try {
                            if (isArmory) {
                                const name = nextDetails.name || `Upgrade ${idx + 1}`;
                                canvas.dataset.fallbackLabel = name;
                            } else {
                                const BuildingClass = BuildingManager.getBuildingClassByType(building.type);
                                const renderable = new BuildingClass(building.color, { x: 0, y: 0 }, variant);
                                this.animatePreview(canvas, renderable);
                            }
                        } catch (error) {
                            canvas.dataset.fallbackLabel = nextDetails.name || `Upgrade ${idx + 1}`;
                        }

                        const label = document.createElement("p");
                        label.classList.add("next-upgrade-icon-label");
                        label.textContent = nextDetails.name || `Upgrade ${idx + 1}`;

                        if (canvas.dataset.fallbackLabel) {
                            const fallback = document.createElement("div");
                            fallback.classList.add("next-upgrade-icon-fallback");
                            fallback.textContent = "UP";
                            item.appendChild(fallback);
                        } else {
                            item.appendChild(canvas);
                        }

                        item.appendChild(label);
                        list.appendChild(item);
                    });

                    tooltip.appendChild(list);
                } else {
                    tooltip.innerHTML = `
                        <p class="title">Next Evolutions</p>
                        <p class="line muted">Max upgrade reached</p>
                    `;
                }

                upgradeItem.appendChild(tooltip);
            };

            const createUpgradeItem = (upgradeInfo, index) => {
                const upgradeItem = document.createElement("div");
                upgradeItem.classList.add("upgrade-item");

                const preview = document.createElement("canvas");
                preview.classList.add("preview");
                preview.width = 80;
                preview.height = 80;

                let renderable;
                if (isArmory) {
                    const unitType = upgradeInfo.unitType ?? this.selectedUpgradeTab;
                    const unitVariant = upgradeInfo.unitVariant ?? upgradeInfo.variant;
                    const UnitClass = UnitManager.getUnitClassByType(unitType);
                    const baseRenderable = new UnitClass(building.color, { x: 0, y: 0 }, unitVariant);
                    renderable = /cloaking device/i.test(upgradeInfo.name)
                        ? this.createCloakingPreviewRenderable(baseRenderable)
                        : baseRenderable;
                } else {
                    const BuildingClass = BuildingManager.getBuildingClassByType(building.type);
                    renderable = new BuildingClass(building.color, { x: 0, y: 0 }, upgradeInfo.variant);
                }

                if (renderable) {
                    this.animatePreview(preview, renderable);
                }

                const description = document.createElement("div");
                description.classList.add("description");
                description.style.cursor = "pointer";
                preview.style.cursor = "pointer";

                const hotkeyBinding = this.getUpgradeHotkeyBindingForItem(building.type, upgradeInfo, {
                    isArmory,
                    selectedUnitType: this.selectedUpgradeTab,
                    index
                });
                description.innerHTML = `
                    <p class="header">${upgradeInfo.name}</p>
                    <p class="text">${upgradeInfo.description}</p>
                    <p class="hotkey">[${hotkeyBinding.label}]</p>
                    <p class="cost">${upgradeInfo.cost} Power</p>
                `;
                this.upgradeCostElements.push({ cost: upgradeInfo.cost, element: description.querySelector(".cost") });

                upgradeItem.appendChild(preview);
                upgradeItem.appendChild(description);
                if (hotkeyBinding.upgradeId) {
                    upgradeItem.dataset.upgradeHotkeyId = hotkeyBinding.upgradeId;
                }
                if (hotkeyBinding.key) {
                    upgradeItem.dataset.upgradeHotkey = hotkeyBinding.key;
                } else {
                    delete upgradeItem.dataset.upgradeHotkey;
                }
                attachNextEvolutionTooltip(upgradeItem, upgradeInfo);

                const triggerUpgradeFromItem = () => {
                    this.tutorialActionMarks.buildingUpgradeAt = Date.now();
                    const baseCost = Number.isFinite(Number(upgradeInfo.baseCost))
                        ? Number(upgradeInfo.baseCost)
                        : (Number(upgradeInfo.cost) / Math.max(1, Number(building.count) || 1));
                    const upgradeAll = Boolean(this.upgradeBulkMode && canBulkAcrossBase);
                    const upgradeData = isArmory
                        ? {
                            unitType: upgradeInfo.unitType ?? this.selectedUpgradeTab,
                            unitVariant: upgradeInfo.unitVariant ?? upgradeInfo.variant,
                            buildingVariant: upgradeInfo.variant,
                            cost: upgradeInfo.cost,
                            baseCost,
                            upgradeAll
                        }
                        : { buildingVariant: upgradeInfo.variant, cost: upgradeInfo.cost, baseCost, upgradeAll };
                    onUpgradeSelect(upgradeData);
                };
                upgradeItem.addEventListener("click", triggerUpgradeFromItem);
                preview.addEventListener("click", (event) => {
                    event.stopPropagation();
                    triggerUpgradeFromItem();
                });
                description.addEventListener("click", (event) => {
                    event.stopPropagation();
                    triggerUpgradeFromItem();
                });

                this.DOM.game.upgrades.list.appendChild(upgradeItem);

                this._updateCost();
            };

            const handleEmptyUpgrades = (availableUpgrades) => {
                if (isArmory && availableUpgrades.length < 2) {
                    for (let i = 0; i < 2 - availableUpgrades.length; i++) {
                        const comingSoonItem = document.createElement("div");
                        comingSoonItem.classList.add("upgrade-item", "coming-soon");
                        comingSoonItem.innerHTML = "<p>In the lab - upgrades incoming!</p>";
                        this.DOM.game.upgrades.list.appendChild(comingSoonItem);
                    }
                } else if (availableUpgrades.length === 0) {
                    const noUpgradesItem = document.createElement("div");
                    noUpgradesItem.classList.add("upgrade-item", "coming-soon");
                    noUpgradesItem.innerHTML = "<p>No upgrades available</p>";
                    this.DOM.game.upgrades.list.appendChild(noUpgradesItem);
                }
            };

            const availableUpgrades = getAvailableUpgrades();
            const nonPluralizable = new Set(["Barracks"]);
            const buildingLabel = nonPluralizable.has(building.name)
                ? building.name
                : building.count === 1
                    ? building.name
                    : `${building.name}s`;

            document.querySelector("#upgrade-container h1").textContent =
                building.count > 1 ? `${buildingLabel} (${building.count})` : buildingLabel;

            if (isBarracks && building.count === 1) {
                this._populateBarrackActivationSettings(building, onUpgradeSelect);
            } else {
                this._clearUpgradeTabsElement();
            }

            if (canBulkAcrossBase) {
                const bulkActions = document.createElement("div");
                bulkActions.id = "upgrade-bulk-actions";

                const bulkToggleButton = document.createElement("button");
                bulkToggleButton.type = "button";
                bulkToggleButton.id = "upgrade-bulk-toggle-button";
                bulkToggleButton.classList.add("upgrade-bulk-action-btn");

                const refreshBulkModeButton = () => {
                    bulkToggleButton.classList.toggle("active", this.upgradeBulkMode);
                    bulkToggleButton.textContent = this.upgradeBulkMode
                        ? `AutoUpgrade: ON [${keyUpgradeAllMode}]`
                        : `AutoUpgrade: OFF [${keyUpgradeAllMode}]`;
                };
                refreshBulkModeButton();

                bulkToggleButton.addEventListener("click", () => {
                    this.upgradeBulkMode = !this.upgradeBulkMode;
                    refreshBulkModeButton();
                    this.addChatMessage(
                        "System",
                        this.upgradeBulkMode ? "AutoUpgrade enabled." : "AutoUpgrade disabled.",
                        "#60c1ff"
                    );
                });
                bulkActions.appendChild(bulkToggleButton);

                this.DOM.game.upgrades.list.appendChild(bulkActions);

                const buildingDetailsForAll = getBuildingDetails(building.type, building.variant);
                if (buildingDetailsForAll) {
                    const refundAmountAll = Number.isFinite(Number(building?.allRefund))
                        ? Math.max(0, Math.floor(Number(building.allRefund)))
                        : Math.floor(buildingDetailsForAll.cost * allCount / 2);
                    const destroyAllButton = document.createElement("button");
                    destroyAllButton.type = "button";
                    destroyAllButton.id = "upgrade-destroy-all-button";
                    destroyAllButton.classList.add("upgrade-destroy-all-button");
                    destroyAllButton.innerHTML = `
                        <p>Sell All</p>
                        <p class="refund-amount">+${refundAmountAll} Power</p>
                    `;
                    destroyAllButton.addEventListener("click", () => {
                        this.tutorialActionMarks.sellAt = Date.now();
                        onDestroyClicked?.({ applyAll: true });
                    });
                    this.DOM.game.upgrades.container.appendChild(destroyAllButton);
                }
            }

            availableUpgrades.forEach((upgradeInfo, index) => {
                if (upgradeInfo && (upgradeInfo.baseCost || upgradeInfo.cost)) {
                    const baseCost = upgradeInfo.baseCost ?? upgradeInfo.cost;
                    const calculatedCost = baseCost * building.count;
                    const upgradeInfoCopy = { ...upgradeInfo, baseCost, cost: calculatedCost };
                    createUpgradeItem(upgradeInfoCopy, index);
                } else {
                    console.warn(`Invalid upgradeInfo at index ${index}:`, upgradeInfo);
                }
            });
            
            handleEmptyUpgrades(availableUpgrades);

            const buildingDetails = getBuildingDetails(building.type, building.variant);
            if (buildingDetails) {
                const refundAmount = Math.floor(buildingDetails.cost * building.count / 2);
                this.DOM.game.upgrades.destroyButton.innerHTML = `<p>${this.t("game.destroy")}</p><p class="refund-amount">+${refundAmount} Power</p>`;
            }
        }

        // Show the upgrade container
        this.DOM.game.upgrades.container.style.display = "flex";
    }

    updateBarrackActivationTab (tab = null) {
        const tabContainer = this.DOM.game.upgrades.tabs;
        const amountActive = this.core.gameManager.activeBarracks.current;
        const maxActive = this.core.gameManager.activeBarracks.max;

        // If no tab is passed, get the first tab in the container
        if (!tab && tabContainer) {
            // Look for the tab that has the correct data-type attribute
            tab = tabContainer.querySelector(".tab[data-type='barracks-activation-toggle']");
        }

        if (tab) {
            tab.innerHTML = `
                <p class="text">${amountActive}/${maxActive} Activated</p>
                <p class="hotkey">[F]</p>
            `;
        }
    }

    _populateBarrackActivationSettings (building, onUpgradeSelect) {
        let amountActive = this.core.gameManager.activeBarracks.current;
        let maxActive = this.core.gameManager.activeBarracks.max;

        const tabContainer = this.DOM.game.upgrades.tabs;
        tabContainer.innerHTML = ""; // Clear existing tabs

        this.selectedUpgradeTab = 0; // Deselect tab

        const tab = document.createElement("div");
        tab.classList.add("tab");
        tab.setAttribute("data-type", "barracks-activation-toggle");
        tab.classList.toggle("selected", building.activated);
        tab.innerHTML = `
        <p class="text">${amountActive}/${maxActive} Activated</p>
        <p class="hotkey">[F]</p>`;

        // Add click listener for changing selected upgrade tab
        const tabClickHandler = () => {
            let updated = false;

            // Update active amount and toggle tab selection
            if (amountActive < maxActive && !building.activated) {
                amountActive++;
                this.core.gameManager.increaseActiveBarracks(1);
                tab.classList.add("selected");
                updated = true;
            } else if (building.activated) {
                // If the building is already activated, toggle it off
                amountActive--;
                this.core.gameManager.decreaseActiveBarracks(1);
                tab.classList.remove("selected");
                updated = true;
            }

            // Only proceed if the tab was updated (status changed)
            if (updated) {
                // Toggle the building"s activation state
                building.activated = !building.activated;

                // Trigger the upgrade selection handler
                onUpgradeSelect();
            }
        };

        tab.addEventListener("click", tabClickHandler);
        tabContainer.appendChild(tab);
    }

    _clearUpgradeTabsElement () {
        const tabContainer = this.DOM.game.upgrades.tabs;
        tabContainer.innerHTML = ""; // Clear existing tabs
    }

    _updateCost () {
        this.upgradeCostElements.forEach(i => {
            const { cost, element } = i;
            if (cost > this.core.gameManager.resources.power.current) {
                element.style.color = "red";
            } else {
                element.style.color = "white";
            }
        });
    }

    hideUpgrades (resetBulkMode = true) {
        if (this.DOM.game.upgrades.container.style.display === "none") return;
        this.upgradeCostElements = []; // Clear
        if (resetBulkMode) {
            this.upgradeBulkMode = false;
        }

        const destroyAllButton = document.getElementById("upgrade-destroy-all-button");
        if (destroyAllButton?.parentNode) {
            destroyAllButton.parentNode.removeChild(destroyAllButton);
        }


        // Make the destroy button visible in case it got set to none (see showCoreUpgrades())
        this.DOM.game.upgrades.destroyButton.style.display = "flex";


        // Stop and remove previous animations
        Array.from(this.DOM.game.upgrades.list.querySelectorAll("canvas")).forEach(canvas => {
            if (canvas.stopAnimation) {
                canvas.stopAnimation();
            }
        });

        // Clone the tab container and replace it to remove event listeners
        const tabContainerClone = this.DOM.game.upgrades.tabs.cloneNode();
        this.DOM.game.upgrades.tabs.parentNode.replaceChild(tabContainerClone, this.DOM.game.upgrades.tabs);
        this.DOM.game.upgrades.tabs = tabContainerClone; // Update reference

        this.DOM.game.upgrades.container.style.display = "none"; // Hide the panel
        this.DOM.game.upgrades.container.dataset.mode = "";
    }

    addChatMessage (username, message, color, player = null) {
        const safeUsername = String(username || "");
        const safeMessage = String(message || "").trim();
        if (!safeMessage) return;

        if (safeUsername.toLowerCase() === "system") {
            const lowerColor = String(color || "").toLowerCase();
            const isWarn = lowerColor.includes("ffcc66") || lowerColor.includes("ffa");
            const isSuccess = lowerColor.includes("7cfc00") || lowerColor.includes("6bff");
            if (isWarn) {
                this.showScreenNotice(safeMessage, {
                    textColor: "#ffeec9",
                    borderColor: "rgba(255, 205, 120, 0.82)"
                });
            } else if (isSuccess) {
                this.showScreenNotice(safeMessage, {
                    textColor: "#e8ffef",
                    borderColor: "rgba(120, 255, 165, 0.78)",
                    background: "linear-gradient(145deg, rgba(14, 48, 34, 0.92), rgba(18, 62, 40, 0.92))"
                });
            } else {
                this.showScreenNotice(safeMessage, {
                    textColor: "#eaf4ff",
                    borderColor: "rgba(120, 205, 255, 0.82)",
                    background: "linear-gradient(145deg, rgba(14, 23, 56, 0.95), rgba(20, 35, 72, 0.95))"
                });
            }
            return;
        }

        if (!this.DOM.chat.messages) return;

        // Create a new chat message div
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message");

        // Check for mention
        if (this.core.gameManager.player && safeMessage.includes('@' + this.core.gameManager.player.name)) {
            messageDiv.classList.add("mention-highlight");
        }

        // Create and set username span
        const usernameSpan = document.createElement("span");
        usernameSpan.classList.add("name");
        usernameSpan.textContent = safeUsername;
        usernameSpan.style.color = color;
        if (this.core?.networkManager?.isOwnerDisplayName?.(safeUsername)) {
            messageDiv.classList.add("owner-message");
            usernameSpan.classList.add("owner-name");
        }
        if (player) {
            usernameSpan.style.cursor = "pointer";
            // Add click event listener to usernameSpan
            usernameSpan.addEventListener("click", () => this.handleUsernameClick(player));
        }

        // Create and set message span
        const messageSpan = document.createElement("span");
        messageSpan.classList.add("text");
        messageSpan.textContent = safeMessage;

        // Append username and message spans to message div
        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(messageSpan);

        // Append the new message div to the chat messages container
        this.DOM.chat.messages.appendChild(messageDiv);

        // Scroll to the bottom to show the latest message
        this.DOM.chat.messages.scrollTop = this.DOM.chat.messages.scrollHeight;
    }

    showScreenNotice (message, options = {}) {
        if (!message) return;
        const {
            durationMs = 2800,
            textColor = "#fff4d6",
            borderColor = "rgba(255, 205, 120, 0.82)",
            background = "linear-gradient(145deg, rgba(26, 16, 46, 0.95), rgba(34, 20, 60, 0.95))"
        } = options || {};

        if (!this.screenNoticeElement) {
            const element = document.createElement("div");
            element.style.position = "fixed";
            element.style.left = "50%";
            element.style.top = "72px";
            element.style.transform = "translateX(-50%)";
            element.style.zIndex = "25050";
            element.style.maxWidth = "min(82vw, 780px)";
            element.style.padding = "10px 14px";
            element.style.borderRadius = "10px";
            element.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";
            element.style.fontSize = "13px";
            element.style.fontWeight = "800";
            element.style.letterSpacing = "0.02em";
            element.style.pointerEvents = "none";
            element.style.boxShadow = "0 10px 22px rgba(0,0,0,0.42), 0 0 12px rgba(149, 124, 255, 0.28)";
            element.style.opacity = "0";
            element.style.transition = "opacity 140ms ease";
            document.body.appendChild(element);
            this.screenNoticeElement = element;
        }

        if (this.screenNoticeHideTimeout) {
            clearTimeout(this.screenNoticeHideTimeout);
            this.screenNoticeHideTimeout = null;
        }

        this.screenNoticeElement.textContent = String(message);
        this.screenNoticeElement.style.color = textColor;
        this.screenNoticeElement.style.background = background;
        this.screenNoticeElement.style.border = `1px solid ${borderColor}`;
        this.screenNoticeElement.style.opacity = "1";

        this.screenNoticeHideTimeout = setTimeout(() => {
            if (!this.screenNoticeElement) return;
            this.screenNoticeElement.style.opacity = "0";
        }, Math.max(900, Number(durationMs) || 2800));
    }

    notifySystemWarning (message) {
        const text = String(message || "").trim();
        if (!text) return;
        this.showScreenNotice(text, {
            textColor: "#ffeec9",
            borderColor: "rgba(255, 205, 120, 0.82)"
        });
    }

    notifySystemInfo (message) {
        const text = String(message || "").trim();
        if (!text) return;
        this.showScreenNotice(text, {
            textColor: "#eaf4ff",
            borderColor: "rgba(120, 205, 255, 0.82)",
            background: "linear-gradient(145deg, rgba(14, 23, 56, 0.95), rgba(20, 35, 72, 0.95))"
        });
    }

    handleUsernameClick (player) {
        this.tutorialActionMarks.leaderboardNickAt = Date.now();
        this.core.camera.setPosition(player.position, true);
    }

    syncGroupTroopsState (active = false, syncServer = false) {
        this.groupUnitsActive = Boolean(active);

        const groupUnitsButton = this.DOM?.game?.unitControls?.groupUnitsButton;
        if (groupUnitsButton) {
            groupUnitsButton.classList.toggle("active", this.groupUnitsActive);
            groupUnitsButton.innerText = this.groupUnitsActive
                ? this.t("game.groupTroopsOn")
                : this.t("game.groupTroopsOff");
        }

        const topGroupToggle = document.getElementById("top-group-toggle-btn");
        if (topGroupToggle) {
            topGroupToggle.textContent = this.groupUnitsActive
                ? this.t("game.groupTroopsOn")
                : this.t("game.groupTroopsOff");
            if (this.groupUnitsActive) {
                topGroupToggle.style.background = "rgba(44, 22, 76, 0.78)";
                topGroupToggle.style.borderColor = "rgba(180, 160, 255, 0.55)";
                topGroupToggle.style.boxShadow = "0 6px 16px rgba(180, 160, 255, 0.20)";
                topGroupToggle.style.color = "#e9ddff";
            } else {
                topGroupToggle.style.background = "rgba(20, 10, 40, 0.6)";
                topGroupToggle.style.borderColor = "rgba(180, 160, 255, 0.3)";
                topGroupToggle.style.boxShadow = "0 4px 12px rgba(180, 160, 255, 0.14)";
                topGroupToggle.style.color = "#e0d6ff";
            }
        }

        if (syncServer) {
            const networkManager = this.core?.networkManager;
            const inMatch = Boolean(this.core?.gameManager?.player);
            if (inMatch && networkManager && typeof networkManager.sendToggleGroupUnits === "function") {
                networkManager.sendToggleGroupUnits(this.groupUnitsActive);
            }
        }
    }

    addUnitControlsListener() {
        const groupUnitsButton = this.DOM?.game?.unitControls?.groupUnitsButton;
        if (!groupUnitsButton) return;
        if (groupUnitsButton.dataset.groupToggleBound === "1") return;
        groupUnitsButton.dataset.groupToggleBound = "1";

        // Guarantee default state as OFF in UI without sending gameplay packet pre-join.
        this.syncGroupTroopsState(false, false);

        groupUnitsButton.addEventListener("click", (event) => {
            event.stopPropagation();
            this.syncGroupTroopsState(!this.groupUnitsActive, true);
        });
    }

    addAutoBuildMenuButtons () {
        const gameContainer = this.DOM?.game?.container;
        if (!gameContainer) return;
        if (document.getElementById("autobuild-menu-container")) return;

        const container = document.createElement("div");
        container.id = "autobuild-menu-container";
        container.style.position = "absolute";
        container.style.top = "8px";
        container.style.left = "50%";
        container.style.transform = "translateX(-50%)";
        container.style.display = "none";
        container.style.width = "min(560px, calc(100vw - 32px))";
        container.style.height = "46px";
        container.style.zIndex = "30";
        container.style.pointerEvents = "auto";
        container.style.filter = "drop-shadow(0 5px 10px rgba(0, 0, 0, 0.24))";

        const pullTab = document.createElement("button");
        pullTab.id = "top-menu-pulltab";
        pullTab.type = "button";
        pullTab.textContent = this.t("game.menu");
        pullTab.style.pointerEvents = "auto";
        pullTab.style.position = "absolute";
        pullTab.style.left = "50%";
        pullTab.style.transform = "translateX(-50%)";
        pullTab.style.top = "0";
        pullTab.style.width = "72px";
        pullTab.style.height = "24px";
        pullTab.style.padding = "0";
        pullTab.style.border = "1px solid rgba(180, 160, 255, 0.3)";
        pullTab.style.borderRadius = "10px";
        pullTab.style.background = "rgba(20, 10, 40, 0.6)";
        pullTab.style.boxShadow = "0 6px 16px rgba(180, 160, 255, 0.14)";
        pullTab.style.color = "#e0d6ff";
        pullTab.style.cursor = "pointer";
        pullTab.style.fontWeight = "700";
        pullTab.style.fontSize = "10px";
        pullTab.style.letterSpacing = "0.3px";
        pullTab.style.textShadow = "0 1px 0 rgba(0, 0, 0, 0.35)";
        pullTab.style.transition = "transform 0.16s ease, box-shadow 0.2s ease, filter 0.2s ease";
        pullTab.addEventListener("mouseenter", () => {
            pullTab.style.transform = "translateX(-50%) translateY(-1px)";
            pullTab.style.boxShadow = "0 10px 26px rgba(180, 160, 255, 0.24)";
            pullTab.style.filter = "none";
        });
        pullTab.addEventListener("mouseleave", () => {
            pullTab.style.transform = "translateX(-50%)";
            pullTab.style.boxShadow = "0 8px 24px rgba(180, 160, 255, 0.16)";
            pullTab.style.filter = "none";
        });

        const actionsPanel = document.createElement("div");
        actionsPanel.id = "top-menu-actions-panel";
        actionsPanel.style.position = "absolute";
        actionsPanel.style.left = "50%";
        actionsPanel.style.transform = "translateX(-50%)";
        actionsPanel.style.top = "0";
        actionsPanel.style.width = "100%";
        actionsPanel.style.maxWidth = "min(560px, calc(100vw - 32px))";
        actionsPanel.style.height = "44px";
        actionsPanel.style.display = "none";
        actionsPanel.style.padding = "3px";
        actionsPanel.style.boxSizing = "border-box";
        actionsPanel.style.borderRadius = "11px";
        actionsPanel.style.border = "1px solid rgba(180, 160, 255, 0.3)";
        actionsPanel.style.background = "rgba(20, 10, 40, 0.6)";
        actionsPanel.style.boxShadow = "0 6px 18px rgba(180, 160, 255, 0.16)";
        actionsPanel.style.backdropFilter = "blur(8px)";
        actionsPanel.style.gap = "3px";
        actionsPanel.style.gridTemplateColumns = "repeat(6, minmax(0, 1fr))";
        actionsPanel.style.gridAutoRows = "18px";
        actionsPanel.style.alignItems = "stretch";

        const createActionButton = (label, onClick) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.style.width = "100%";
            button.style.maxWidth = "none";
            button.style.height = "18px";
            button.style.padding = "0 5px";
            button.style.border = "1px solid rgba(180, 160, 255, 0.28)";
            button.style.borderRadius = "6px";
            button.style.background = "rgba(20, 10, 40, 0.52)";
            button.style.boxShadow = "none";
            button.style.color = "#e0d6ff";
            button.style.cursor = "pointer";
            button.style.fontWeight = "700";
            button.style.letterSpacing = "0.1px";
            button.style.fontSize = "9px";
            button.style.userSelect = "none";
            button.style.whiteSpace = "nowrap";
            button.style.overflow = "hidden";
            button.style.textOverflow = "ellipsis";
            button.style.textShadow = "0 1px 0 rgba(0, 0, 0, 0.35)";
            button.style.transition = "transform 0.12s ease, background 0.15s ease, border-color 0.15s ease";
            button.addEventListener("mouseenter", () => {
                if (button.dataset.pressed === "true") return;
                button.style.transform = "translateY(-1px)";
                button.style.borderColor = "rgba(180, 160, 255, 0.42)";
                button.style.background = "rgba(30, 15, 60, 0.7)";
            });
            button.addEventListener("mouseleave", () => {
                if (button.dataset.pressed === "true") {
                    button.style.transform = "translateY(1px)";
                    return;
                }
                button.style.transform = "translateY(0)";
                button.style.borderColor = "rgba(180, 160, 255, 0.28)";
                button.style.background = "rgba(20, 10, 40, 0.52)";
            });
            button.addEventListener("mousedown", () => {
                button.dataset.pressed = "true";
                button.style.transform = "translateY(1px)";
                button.style.background = "rgba(16, 8, 32, 0.78)";
            });
            const resetPress = () => {
                button.dataset.pressed = "false";
                button.style.transform = "translateY(0)";
                button.style.background = "rgba(20, 10, 40, 0.52)";
            };
            button.addEventListener("mouseup", resetPress);
            button.addEventListener("blur", resetPress);
            button.addEventListener("click", onClick);
            return button;
        };

        const autogensBtn = createActionButton("Autogens", () => {
            this.tutorialActionMarks.autogensAt = Date.now();
            this.core.buildingManager.autoPlaceGenerators();
        });
        autogensBtn.id = "top-autogens-btn";
        const externatkBtn = createActionButton("ExternaTK", () => {
            this.tutorialActionMarks.externatkAt = Date.now();
            this.core.buildingManager.placeExternalAtkArmory();
        });
        externatkBtn.id = "top-externatk-btn";
        const defendBtn = createActionButton("Defend", () => {
            this.tutorialActionMarks.defendAt = Date.now();
            this.core.buildingManager.activateDefendMode();
        });
        defendBtn.id = "top-defend-btn";
        const saveBaseBtn = createActionButton("Save Base", () => {
            this.tutorialActionMarks.saveBaseAt = Date.now();
            this.showSaveBaseLayoutDialog();
        });
        saveBaseBtn.id = "top-save-base-btn";
        const loadBaseBtn = createActionButton("Load Base", () => {
            this.tutorialActionMarks.loadBaseAt = Date.now();
            this.showLoadBaseLayoutDialog();
        });
        loadBaseBtn.id = "top-load-base-btn";
        const topDiscordBtn = createActionButton(this.t("menu.discord"), () => {
            window.open("https://discord.gg/YAEG9qJGMh", "_blank", "noopener,noreferrer");
        });
        topDiscordBtn.id = "top-discord-btn";
        const themeBtn = createActionButton(this.t("game.theme").replace(":", ""), () => {
            this.tutorialActionMarks.themeAt = Date.now();
            this.positionSettingsPanelForTopMenu(themeBtn);
            this._pinAutoBuildMenuOpen = true;
            if (typeof this._autoBuildShowActions === "function") {
                this._autoBuildShowActions();
            }
            this.showGameSettingsButton(false);
            this.showGameSettingsPanel(true);
        });
        themeBtn.style.height = "20px";
        themeBtn.id = "top-theme-btn";
        themeBtn.style.gridColumn = "3 / span 2";
        themeBtn.style.background = "rgba(24, 12, 48, 0.62)";
        themeBtn.style.borderColor = "rgba(180, 160, 255, 0.34)";
        themeBtn.style.color = "#b4a0ff";
        themeBtn.style.fontSize = "9px";

        const showActions = () => {
            this.tutorialActionMarks.topMenuAt = Date.now();
            pullTab.style.display = "none";
            actionsPanel.style.display = "grid";
        };
        const showMenu = () => {
            if (this._pinAutoBuildMenuOpen) return;
            actionsPanel.style.display = "none";
            pullTab.style.display = "block";
        };
        let hoverOpenTimer = null;
        let hoverCloseTimer = null;
        const supportsHover = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(hover: hover)").matches;
        const clearHoverTimers = () => {
            if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
            if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
            hoverOpenTimer = null;
            hoverCloseTimer = null;
        };
        const scheduleShow = () => {
            if (!supportsHover) return;
            if (hoverCloseTimer) clearTimeout(hoverCloseTimer);
            if (actionsPanel.style.display === "grid") return;
            hoverOpenTimer = setTimeout(() => showActions(), 90);
        };
        const scheduleHide = () => {
            if (!supportsHover) return;
            if (this._pinAutoBuildMenuOpen) return;
            if (hoverOpenTimer) clearTimeout(hoverOpenTimer);
            hoverCloseTimer = setTimeout(() => showMenu(), 150);
        };
        if (supportsHover) {
            pullTab.addEventListener("mouseenter", scheduleShow);
            container.addEventListener("mouseenter", scheduleShow);
            container.addEventListener("mouseleave", scheduleHide);
            actionsPanel.addEventListener("mouseenter", scheduleShow);
            actionsPanel.addEventListener("mouseleave", scheduleHide);
        } else {
            // Touch fallback: still allow tap to open/close.
            pullTab.addEventListener("click", showActions);
            container.addEventListener("mouseleave", showMenu);
        }
        container.addEventListener("remove", clearHoverTimers);
        this._autoBuildShowActions = showActions;
        this._autoBuildShowMenu = showMenu;

        actionsPanel.appendChild(autogensBtn);
        actionsPanel.appendChild(externatkBtn);
        actionsPanel.appendChild(defendBtn);
        actionsPanel.appendChild(saveBaseBtn);
        actionsPanel.appendChild(loadBaseBtn);
        actionsPanel.appendChild(topDiscordBtn);
        actionsPanel.appendChild(themeBtn);
        container.appendChild(pullTab);
        container.appendChild(actionsPanel);
        gameContainer.appendChild(container);
    }

    addMusicControls () {
        const gameContainer = this.DOM?.game?.container;
        if (!gameContainer) return;
        if (document.getElementById("music-controls-container")) return;

        const container = document.createElement("div");
        container.id = "music-controls-container";
        container.style.position = "static";
        container.style.zIndex = "35";
        container.style.display = "none";
        container.style.flexDirection = "column";
        container.style.alignItems = "flex-start";
        container.style.gap = "6px";
        container.style.pointerEvents = "auto";
        const swallowMusicEvent = (event) => event.stopPropagation();
        ["pointerdown", "mousedown", "touchstart", "click"].forEach((eventName) => {
            container.addEventListener(eventName, swallowMusicEvent);
        });

        const launcher = document.createElement("button");
        launcher.type = "button";
        launcher.textContent = "MUSIC";
        launcher.style.height = "28px";
        launcher.style.padding = "0 12px";
        launcher.style.borderRadius = "999px";
        launcher.style.border = "1px solid rgba(180, 160, 255, 0.38)";
        launcher.style.background = "rgba(20, 10, 40, 0.74)";
        launcher.style.color = "#e5dcff";
        launcher.style.fontSize = "11px";
        launcher.style.fontWeight = "800";
        launcher.style.letterSpacing = "0.4px";
        launcher.style.cursor = "pointer";
        launcher.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.35)";

        const panel = document.createElement("div");
        panel.style.display = "none";
        panel.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
        panel.style.gap = "6px";
        panel.style.width = "220px";
        panel.style.padding = "10px";
        panel.style.borderRadius = "12px";
        panel.style.border = "1px solid rgba(180, 160, 255, 0.30)";
        panel.style.background = "rgba(12, 6, 26, 0.86)";
        panel.style.backdropFilter = "blur(8px)";
        panel.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.36)";

        const trackLabel = document.createElement("div");
        trackLabel.style.gridColumn = "1 / span 3";
        trackLabel.style.fontSize = "11px";
        trackLabel.style.fontWeight = "700";
        trackLabel.style.color = "#f0e7ff";
        trackLabel.style.whiteSpace = "nowrap";
        trackLabel.style.overflow = "hidden";
        trackLabel.style.textOverflow = "ellipsis";
        trackLabel.textContent = "Track: loading";

        const volumeLabel = document.createElement("div");
        volumeLabel.style.gridColumn = "1 / span 3";
        volumeLabel.style.fontSize = "10px";
        volumeLabel.style.fontWeight = "700";
        volumeLabel.style.color = "#c7b7f4";
        volumeLabel.textContent = "VOL 0%";

        const createControlButton = (label, onClick) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.style.height = "24px";
            button.style.borderRadius = "8px";
            button.style.border = "1px solid rgba(180, 160, 255, 0.28)";
            button.style.background = "rgba(22, 12, 42, 0.74)";
            button.style.color = "#e0d6ff";
            button.style.fontSize = "10px";
            button.style.fontWeight = "700";
            button.style.cursor = "pointer";
            button.style.transition = "background 0.15s ease, border-color 0.15s ease";
            button.addEventListener("mouseenter", () => {
                button.style.background = "rgba(34, 18, 64, 0.88)";
                button.style.borderColor = "rgba(180, 160, 255, 0.42)";
            });
            button.addEventListener("mouseleave", () => {
                button.style.background = "rgba(22, 12, 42, 0.74)";
                button.style.borderColor = "rgba(180, 160, 255, 0.28)";
            });
            button.addEventListener("click", onClick);
            return button;
        };

        const runMusicAction = async (action) => {
            const musicManager = this.core?.musicManager;
            if (!musicManager) return;
            await musicManager.handleUserGestureStart();
            await action(musicManager);
            this.refreshMusicControls();
        };

        const prevButton = createControlButton("PREV", () => runMusicAction((musicManager) => musicManager.playPrevious()));
        const playPauseButton = createControlButton("PLAY", () => runMusicAction((musicManager) => musicManager.togglePlayPause()));
        const nextButton = createControlButton("NEXT", () => runMusicAction((musicManager) => musicManager.playNext()));
        const volDownButton = createControlButton("VOL-", () => runMusicAction((musicManager) => {
            musicManager.setMasterVolume((musicManager.masterVolume || 0) - 0.1);
        }));
        const muteButton = createControlButton("MUTE", () => runMusicAction((musicManager) => {
            musicManager.setMuted(!musicManager.muted);
        }));
        const volUpButton = createControlButton("VOL+", () => runMusicAction((musicManager) => {
            musicManager.setMasterVolume((musicManager.masterVolume || 0) + 0.1);
        }));

        launcher.addEventListener("click", () => {
            panel.style.display = panel.style.display === "none" ? "grid" : "none";
            this.refreshMusicControls();
        });

        panel.appendChild(trackLabel);
        panel.appendChild(volumeLabel);
        panel.appendChild(prevButton);
        panel.appendChild(playPauseButton);
        panel.appendChild(nextButton);
        panel.appendChild(volDownButton);
        panel.appendChild(muteButton);
        panel.appendChild(volUpButton);

        container.appendChild(panel);
        container.appendChild(launcher);
        gameContainer.appendChild(container);

        this.musicControlsElement = container;
        this.musicControlsTrackLabel = trackLabel;
        this.musicControlsVolumeLabel = volumeLabel;
        this.musicControlsPlayPauseButton = playPauseButton;
        this.musicControlsMuteButton = muteButton;

        const musicManager = this.core?.musicManager;
        if (musicManager?.setOnStateChange) {
            musicManager.setOnStateChange(() => this.refreshMusicControls());
        }
        if (!this._musicControlsResizeHandler) {
            this._musicControlsResizeHandler = () => this.updateMusicControlsPosition();
            window.addEventListener("resize", this._musicControlsResizeHandler);
        }
        this.anchorMusicControlsToPower();
        this.updateMusicControlsPosition();
        this.refreshMusicControls();
    }

    refreshMusicControls () {
        if (!this.musicControlsTrackLabel || !this.musicControlsVolumeLabel) return;
        const musicManager = this.core?.musicManager;
        if (!musicManager || typeof musicManager.getState !== "function") {
            this.musicControlsTrackLabel.textContent = "Track: unavailable";
            this.musicControlsVolumeLabel.textContent = "VOL 0%";
            if (this.musicControlsPlayPauseButton) this.musicControlsPlayPauseButton.textContent = "PLAY";
            if (this.musicControlsMuteButton) this.musicControlsMuteButton.textContent = "MUTE";
            return;
        }

        const state = musicManager.getState();
        const rawTitle = state?.trackTitle || "";
        const clippedTitle = rawTitle.length > 30 ? `${rawTitle.slice(0, 27)}...` : rawTitle;
        this.musicControlsTrackLabel.textContent = clippedTitle ? `Track: ${clippedTitle}` : "Track: none";
        this.musicControlsTrackLabel.title = rawTitle || "";
        this.musicControlsVolumeLabel.textContent = `VOL ${Math.round((state?.masterVolume || 0) * 100)}%`;

        if (this.musicControlsPlayPauseButton) {
            this.musicControlsPlayPauseButton.textContent = state?.playing ? "PAUSE" : "PLAY";
        }
        if (this.musicControlsMuteButton) {
            this.musicControlsMuteButton.textContent = state?.muted ? "UNMUTE" : "MUTE";
        }
    }

    anchorMusicControlsToPower () {
        const musicControls = this.musicControlsElement || document.getElementById("music-controls-container");
        const resourceContainer = this.DOM?.game?.resources?.container || document.getElementById("resource-container");
        const powerElement = this.DOM?.game?.resources?.power || document.getElementById("power");
        if (!musicControls || !resourceContainer || !powerElement) return;

        let powerStack = document.getElementById("resource-power-stack");
        if (!powerStack) {
            powerStack = document.createElement("div");
            powerStack.id = "resource-power-stack";
            powerStack.style.display = "flex";
            powerStack.style.flexDirection = "column";
            powerStack.style.alignItems = "flex-start";
            powerStack.style.gap = "0.45rem";
            resourceContainer.insertBefore(powerStack, resourceContainer.firstChild);
        }

        if (powerElement.parentElement !== powerStack) {
            powerStack.appendChild(powerElement);
        }
        if (musicControls.parentElement !== powerStack) {
            powerStack.insertBefore(musicControls, powerElement);
        }

        // Keep music controls in normal flow, anchored by the resource layout.
        musicControls.style.position = "static";
        musicControls.style.left = "auto";
        musicControls.style.right = "auto";
        musicControls.style.bottom = "auto";
    }

    updateMusicControlsPosition () {
        const musicControls = this.musicControlsElement || document.getElementById("music-controls-container");
        if (!musicControls) return;
        this.anchorMusicControlsToPower();
    }

    positionSettingsPanelForTopMenu (anchorElement) {
        if (!this.DOM?.settings?.panel) return;
        const panel = this.DOM.settings.panel;
        // Keep Theme panel fixed and centered regardless of which top button opened it.
        panel.style.left = "50%";
        panel.style.top = "84px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        panel.style.transform = "translateX(-50%)";
    }

    closeSettingsAfterChoice () {
        // If HUD edit session is active, fully close it and restore last saved HUD layout.
        if (this.hudEditSessionOverlay) {
            this.finishHudEditSession({ save: false });
            return;
        }

        // Safety: never leave edit-mode artifacts behind when closing settings.
        if (this.hudCustomizeMode) {
            this.setHudCustomizeMode(false);
            this.setHudEditPreviewPanels(false);
            this.showUnitStyleEditor(false);
            this.showKeybindEditor(false);
            this.applyHudConfig();
        }

        this.showGameSettingsPanel(false);
        this._pinAutoBuildMenuOpen = false;
        if (typeof this._autoBuildShowMenu === "function") {
            this._autoBuildShowMenu();
        }
    }

    addChatButtonElementListener () {
        if (!this.DOM.chat.button || !this.DOM.chat.input) return;

        this.DOM.chat.button.addEventListener("click", () => {
            const message = this.DOM.chat.input.value.trim();
            if (!message) return;

            const now = Date.now();
            const normalized = message.toLowerCase().replace(/\s+/g, " ").trim();

            // Keep only recent entries for spam checks.
            this.chatSendHistory = this.chatSendHistory.filter((entry) => now - entry.time <= 20000);

            // Repeated same message too soon.
            if (normalized === this.lastSendMessage && (now - this.lastSendMessageAt) < 3000) {
                this.addChatMessage("System", "Please avoid repeating the same message.");
                return;
            }

            // Flood protection: too many messages in short interval.
            const shortWindow = this.chatSendHistory.filter((entry) => now - entry.time <= 2500);
            if (shortWindow.length >= 4) {
                this.addChatMessage("System", "You're sending messages too fast.");
                return;
            }

            // Repeated message pattern in a longer window.
            const sameCount = this.chatSendHistory.filter((entry) => entry.text === normalized).length;
            if (sameCount >= 2) {
                this.addChatMessage("System", "Spam detected. Try a different message.");
                return;
            }

            this.DOM.chat.input.value = ""; // Clear input
            this.core.networkManager.sendChatMessage(message);
            this.tutorialActionMarks.chatAt = now;
            this.lastSendMessage = normalized;
            this.lastSendMessageAt = now;
            this.chatSendHistory.push({ text: normalized, time: now });
        });

        this.DOM.chat.input.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                event.preventDefault(); // Prevent default enter key behavior
                this.DOM.chat.button.click(); // Trigger chat button click
            }
        });
    }

    focusChatInput () {
        const input = this.DOM?.chat?.input;
        if (!input || typeof input.focus !== "function") return false;
        input.focus();
        const textLength = typeof input.value === "string" ? input.value.length : 0;
        if (typeof input.setSelectionRange === "function") {
            input.setSelectionRange(textLength, textLength);
        }
        return true;
    }

    disableChatButtonElementForSeconds (seconds) {
        if (!this.DOM.chat.button) return;

        this.DOM.chat.button.disabled = true;
        let timeRemaining = seconds;
        const originalText = this.DOM.chat.button.textContent;

        const updateTimer = () => {
            if (timeRemaining > 0) {
                this.DOM.chat.button.textContent = `${timeRemaining}s`;
                timeRemaining -= 1;
            } else {
                clearInterval(this.timerInterval);
                this.DOM.chat.button.disabled = false;
                this.DOM.chat.button.textContent = originalText;
            }
        };

        updateTimer(); // Update immediately
        this.timerInterval = setInterval(updateTimer, 1000); // Update every second
    }

    addPlayButtonListener () {
        if (!this.DOM.menu.playButton) return;

        this.DOM.menu.playButton.addEventListener("click", async () => {
            this.core?.musicManager?.handleUserGestureStart?.();
            let confirmed = true;
            try {
                confirmed = await this.showPrePlaySkinPrompt();
            } catch (error) {
                console.warn("Pre-play skin prompt failed, starting directly:", error);
                confirmed = true;
            }
            if (!confirmed) {
                this.core?.setGameplayActive?.(false);
                return;
            }
            this.core?.musicManager?.handleUserGestureStart?.();
            await this.startGameWithSelectedSkin();
        });
    }

    async startGameWithSelectedSkin () {
        // Always start each match with Group Troops OFF in UI.
        // Do not send this packet before join; server can disconnect pre-join gameplay messages.
        this.syncGroupTroopsState(false, false);

        const playerName = this.extractPlayerName();
        localStorage.setItem("playerName", playerName);
        
        // Equipped skin: prefer DB-selected name, else cached numeric id
        let equippedSkinName = this.core.networkManager.loggedIn ? this.core.networkManager.userData?.selected_skin : null;
        const cachedNumeric = Number(localStorage.getItem('equippedSkin')) || 0;
        const cachedName = localStorage.getItem('equippedSkinName') || null;

        if (!equippedSkinName && cachedName) equippedSkinName = cachedName;

        let equippedSkinByte = 0;
        if (equippedSkinName && SkinCache.supabaseNameToId.has(equippedSkinName)) {
            equippedSkinByte = SkinCache.supabaseNameToId.get(equippedSkinName);
        } else if (!isNaN(cachedNumeric) && cachedNumeric > 0) {
            equippedSkinByte = cachedNumeric;
        }

        equippedSkinByte = Math.max(0, Math.min(255, equippedSkinByte));

        let currentSkin = this.availableSkins[this.currentSkinIndex] || null;
        if (equippedSkinName) {
            const byName = this.availableSkins.find((s) => s.name === equippedSkinName);
            if (byName) currentSkin = byName;
        }
        try {
            await this.updateToolbarAccentForSkin(currentSkin);
        } catch (error) {
            console.warn("Failed to update skin accent before join:", error);
        }

        console.log('Joining game with skin (byte):', equippedSkinByte, 'name:', equippedSkinName);
        try {
            this.core.handlePlayButtonPress(playerName, equippedSkinByte);
        } catch (error) {
            console.error("Failed to start match from Play button:", error);
            this.core?.setGameplayActive?.(false);
            this.notifySystemWarning?.("Falha ao iniciar. Tente novamente.");
        }
    }

    async showPrePlaySkinPrompt () {
        if (!Array.isArray(this.availableSkins) || this.availableSkins.length === 0) {
            return true;
        }

        if (this.prePlaySkinPromptElement?.parentNode) {
            this.prePlaySkinPromptElement.parentNode.removeChild(this.prePlaySkinPromptElement);
        }

        return await new Promise((resolve) => {
            let selectedIndex = Math.max(0, Math.min(this.currentSkinIndex || 0, this.availableSkins.length - 1));

            const close = (result) => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                this.prePlaySkinPromptElement = null;
                resolve(Boolean(result));
            };

            const renderCards = () => {
                grid.innerHTML = "";
                this.availableSkins.forEach((skin, index) => {
                    const card = document.createElement("button");
                    card.type = "button";
                    card.className = "preplay-skin-card";
                    if (index === selectedIndex) card.classList.add("selected");
                    card.title = skin.name || "Skin";

                    if (skin.url) {
                        const img = document.createElement("img");
                        img.src = skin.url;
                        img.alt = skin.name || "Skin";
                        card.appendChild(img);
                    } else {
                        const ph = document.createElement("div");
                        ph.className = "preplay-skin-placeholder";
                        ph.textContent = "Default";
                        card.appendChild(ph);
                    }

                    const label = document.createElement("span");
                    label.textContent = skin.name || "Skin";
                    card.appendChild(label);

                    card.addEventListener("click", async () => {
                        selectedIndex = index;
                        this.currentSkinIndex = index;
                        await this.selectCurrentSkin({ persistRemote: true, refreshLibrary: false });
                        selectedName.textContent = this.availableSkins[this.currentSkinIndex]?.name || "Default";
                        renderCards();
                    });

                    grid.appendChild(card);
                });
            };

            const overlay = document.createElement("div");
            overlay.className = "preplay-skin-overlay";

            const modal = document.createElement("div");
            modal.className = "preplay-skin-modal";

            const title = document.createElement("h3");
            title.textContent = "Choose Your Skin";

            const subtitle = document.createElement("div");
            subtitle.className = "preplay-skin-subtitle";
            subtitle.textContent = "Select a skin before joining, or use Random.";

            const selectedLine = document.createElement("div");
            selectedLine.className = "preplay-skin-current";
            selectedLine.innerHTML = `Selected: <span></span>`;
            const selectedName = selectedLine.querySelector("span");
            selectedName.textContent = this.availableSkins[selectedIndex]?.name || "Default";

            const grid = document.createElement("div");
            grid.className = "preplay-skin-grid";

            const actions = document.createElement("div");
            actions.className = "preplay-skin-actions";

            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.className = "preplay-skin-btn secondary";
            cancelBtn.textContent = "Cancel";
            cancelBtn.addEventListener("click", () => close(false));

            const randomBtn = document.createElement("button");
            randomBtn.type = "button";
            randomBtn.className = "preplay-skin-btn";
            randomBtn.textContent = "Random";
            randomBtn.addEventListener("click", async () => {
                const minIndex = this.availableSkins.length > 1 ? 1 : 0;
                const randomIndex = Math.floor(Math.random() * (this.availableSkins.length - minIndex)) + minIndex;
                selectedIndex = randomIndex;
                this.currentSkinIndex = randomIndex;
                await this.selectCurrentSkin({ persistRemote: true, refreshLibrary: false });
                close(true);
            });

            const playBtn = document.createElement("button");
            playBtn.type = "button";
            playBtn.className = "preplay-skin-btn primary";
            playBtn.textContent = "Start";
            playBtn.addEventListener("click", async () => {
                this.currentSkinIndex = selectedIndex;
                await this.selectCurrentSkin({ persistRemote: true, refreshLibrary: false });
                close(true);
            });

            actions.appendChild(cancelBtn);
            actions.appendChild(randomBtn);
            actions.appendChild(playBtn);

            modal.appendChild(title);
            modal.appendChild(subtitle);
            modal.appendChild(actions);
            modal.appendChild(selectedLine);
            modal.appendChild(grid);

            overlay.appendChild(modal);
            overlay.addEventListener("click", (event) => {
                if (event.target === overlay) close(false);
            });

            document.body.appendChild(overlay);
            this.prePlaySkinPromptElement = overlay;
            renderCards();
        });
    }

    addContinueButtonListener () {
        if (!this.DOM.game.over.continueButton) return;
        this.DOM.game.over.continueButton.addEventListener("click", () => {
            this.showGameOverContainer(false);
            this.showMenuUIElements(true);
        });
    }

    addMenuDialogButtonListener () {
        const dialogButton = document.getElementById("menu-dialog-button");
        if (dialogButton) {
            dialogButton.addEventListener("click", () => {
                this.hideMenuDialog();
            });
        }
    }

    addTutorialButtonListener () {
        const tutorialButton = document.getElementById("tutorial-button");
        if (!tutorialButton) return;

        tutorialButton.addEventListener("click", async () => {
            this.core?.musicManager?.handleUserGestureStart?.();
            this.tutorialPendingStart = true;
            this.notifySystemInfo(this.tutorialText(
                "Iniciando tutorial. Aguarde a entrada na partida...",
                "Starting tutorial. Waiting to enter the match...",
                "Iniciando tutorial. Espera para entrar en la partida..."
            ));
            await this.startGameWithSelectedSkin();
        });
    }

    openTutorial () {
        if (this.tutorialModeActive && this.tutorialOverlay) {
            this.tutorialOverlay.style.display = "flex";
            this.showTutorialStep();
            return;
        }

        const player = this.core?.gameManager?.player;
        const camera = this.core?.camera;
        if (!player || !camera) return;

        const countByTypes = (types) => {
            const list = Array.isArray(types) ? types : [types];
            const wanted = new Set(list.map((type) => Number(type)));
            return (player.buildings || []).reduce((count, building) => {
                if (!building || building.removeFlag) return count;
                return wanted.has(Number(building.type)) ? count + 1 : count;
            }, 0);
        };

        this.tutorialModeActive = true;
        this.tutorialStartedAt = Date.now();
        this.tutorialInitialCameraState = {
            x: Number(camera.targetPosition?.x) || Number(camera.x) || 0,
            y: Number(camera.targetPosition?.y) || Number(camera.y) || 0,
            zoom: Number(camera.targetZoom) || Number(camera.zoom) || 1
        };
        this.tutorialBaselineCounts = {
            generator: countByTypes(BuildingTypes.GENERATOR),
            wall: countByTypes(BuildingTypes.WALL),
            turret: countByTypes([BuildingTypes.SIMPLE_TURRET, BuildingTypes.SNIPER_TURRET]),
            barracks: countByTypes(BuildingTypes.BARRACKS),
            house: countByTypes(BuildingTypes.HOUSE),
            armory: countByTypes(BuildingTypes.ARMORY),
            sniperTurret: countByTypes(BuildingTypes.SNIPER_TURRET)
        };

        const tt = (pt, en, es) => this.tutorialText(pt, en, es);
        this.tutorialSteps = [
            {
                key: "intro",
                title: tt("Bem-vindo ao Tutorial Completo", "Welcome to the Full Tutorial", "Bienvenido al Tutorial Completo"),
                content: tt(
                    "Voce vai aprender base, economia, defesa, tropas e comandos principais em uma partida real.",
                    "You will learn base building, economy, defense, troops, and core commands in a real match.",
                    "Vas a aprender base, economia, defensa, tropas y comandos clave en una partida real."
                ),
                action: tt("Objetivo: leia e clique em Proxima para iniciar.", "Goal: read and click Next to start.", "Objetivo: lee y haz clic en Siguiente para empezar."),
                pointerText: tt("Tutorial passo a passo", "Step-by-step tutorial", "Tutorial paso a paso")
            },
            {
                key: "enemy",
                title: tt("Treino Contra Oponente", "Practice Against an Opponent", "Practica Contra un Oponente"),
                content: tt(
                    "O tutorial foi montado para praticar contra adversario ativo (normalmente bots no servidor).",
                    "This tutorial is designed to practice against an active opponent (usually server bots).",
                    "Este tutorial esta hecho para practicar contra un oponente activo (normalmente bots del servidor)."
                ),
                action: tt(
                    "Objetivo: aguarde aparecer pelo menos 1 oponente no leaderboard.",
                    "Goal: wait until at least 1 opponent appears on the leaderboard.",
                    "Objetivo: espera hasta que aparezca al menos 1 oponente en el leaderboard."
                ),
                targetSelector: "#leaderboard-container",
                pointerText: tt("Aqui aparecem os oponentes", "Opponents appear here", "Aqui aparecen los oponentes")
            },
            {
                key: "nick_focus",
                title: tt("Focar Base Pelo Nick", "Focus Base by Nickname", "Enfocar Base por Nick"),
                content: tt(
                    "Clique no nick de um jogador no leaderboard para centralizar camera na base dele.",
                    "Click a player's nickname in the leaderboard to center the camera on their base.",
                    "Haz clic en el nick de un jugador en el leaderboard para centrar la camara en su base."
                ),
                action: tt("Objetivo: clique em um nome no leaderboard.", "Goal: click a name in the leaderboard.", "Objetivo: haz clic en un nombre del leaderboard."),
                targetSelector: "#leaderboard-container",
                pointerText: tt("Clique no nick aqui", "Click a nickname here", "Haz clic en un nick aqui")
            },
            {
                key: "camera",
                title: tt("Movimento da Camera", "Camera Movement", "Movimiento de Camara"),
                content: tt(
                    "Use WASD ou setas para mover camera. Tambem pode arrastar com o mouse.",
                    "Use WASD or arrow keys to move the camera. You can also drag with the mouse.",
                    "Usa WASD o flechas para mover la camara. Tambien puedes arrastrar con el mouse."
                ),
                action: tt("Objetivo: mova a camera um pouco para continuar.", "Goal: move the camera a bit to continue.", "Objetivo: mueve un poco la camara para continuar."),
                pointerText: tt("Mova com WASD", "Move with WASD", "Mueve con WASD")
            },
            {
                key: "power_info",
                title: tt("Power (Recurso Principal)", "Power (Main Resource)", "Power (Recurso Principal)"),
                content: tt(
                    "Tudo no jogo consome Power: construir, expandir e fortalecer a base.",
                    "Everything in the game consumes Power: building, expanding, and strengthening your base.",
                    "Todo en el juego consume Power: construir, expandir y fortalecer tu base."
                ),
                action: tt("Objetivo: observe seu Power e clique em Proxima.", "Goal: check your Power and click Next.", "Objetivo: mira tu Power y haz clic en Siguiente."),
                targetSelector: "#power",
                pointerText: tt("Seu Power fica aqui", "Your Power is here", "Tu Power esta aqui")
            },
            {
                key: "select_generator",
                title: tt("Selecionar Generator", "Select Generator", "Seleccionar Generator"),
                content: tt(
                    "Generator acelera sua economia para o mid/late game.",
                    "Generator boosts your economy for mid/late game.",
                    "Generator acelera tu economia para mid/late game."
                ),
                action: tt("Objetivo: clique no icone de Generator na barra inferior.", "Goal: click the Generator icon in the bottom bar.", "Objetivo: haz clic en el icono de Generator en la barra inferior."),
                targetBuildingType: BuildingTypes.GENERATOR,
                pointerText: tt("Clique no Generator", "Click Generator", "Haz clic en Generator")
            },
            {
                key: "generator",
                title: tt("Construir Generator", "Build Generator", "Construir Generator"),
                content: tt(
                    "Com o Generator selecionado, posicione no mapa para aumentar geracao de Power.",
                    "With Generator selected, place it on the map to increase Power generation.",
                    "Con Generator seleccionado, colocarlo en el mapa para aumentar la generacion de Power."
                ),
                action: tt("Objetivo: coloque 1 Generator.", "Goal: place 1 Generator.", "Objetivo: coloca 1 Generator."),
                targetBuildingType: BuildingTypes.GENERATOR,
                pointerText: tt("Posicione um Generator", "Place a Generator", "Coloca un Generator")
            },
            {
                key: "select_house",
                title: tt("Selecionar House", "Select House", "Seleccionar House"),
                content: tt(
                    "House aumenta populacao maxima para voce produzir mais unidades.",
                    "House increases max population so you can produce more units.",
                    "House aumenta la poblacion maxima para producir mas unidades."
                ),
                action: tt("Objetivo: clique no icone de House.", "Goal: click the House icon.", "Objetivo: haz clic en el icono de House."),
                targetBuildingType: BuildingTypes.HOUSE,
                pointerText: tt("Clique na House", "Click House", "Haz clic en House")
            },
            {
                key: "house",
                title: tt("Construir House", "Build House", "Construir House"),
                content: tt(
                    "Sem populacao livre suas barracks param de gerar tropas.",
                    "Without free population, your barracks stop producing troops.",
                    "Sin poblacion libre, tus barracks dejan de generar tropas."
                ),
                action: tt("Objetivo: coloque 1 House.", "Goal: place 1 House.", "Objetivo: coloca 1 House."),
                targetBuildingType: BuildingTypes.HOUSE,
                pointerText: tt("Posicione uma House", "Place a House", "Coloca una House")
            },
            {
                key: "select_wall",
                title: tt("Selecionar Wall", "Select Wall", "Seleccionar Wall"),
                content: tt(
                    "Wall segura investidas e da tempo para suas torres reagirem.",
                    "Wall holds enemy pushes and buys time for your turrets to react.",
                    "Wall frena ataques y da tiempo para que tus torres reaccionen."
                ),
                action: tt("Objetivo: clique no icone de Wall.", "Goal: click the Wall icon.", "Objetivo: haz clic en el icono de Wall."),
                targetBuildingType: BuildingTypes.WALL,
                pointerText: tt("Clique na Wall", "Click Wall", "Haz clic en Wall")
            },
            {
                key: "wall",
                title: tt("Construir Wall", "Build Wall", "Construir Wall"),
                content: tt("Feche pontos de entrada proximos da sua base.", "Close entry points near your base.", "Cierra puntos de entrada cerca de tu base."),
                action: tt("Objetivo: coloque 1 Wall.", "Goal: place 1 Wall.", "Objetivo: coloca 1 Wall."),
                targetBuildingType: BuildingTypes.WALL,
                pointerText: tt("Coloque uma Wall", "Place a Wall", "Coloca una Wall")
            },
            {
                key: "select_turret",
                title: tt("Selecionar Turret", "Select Turret", "Seleccionar Turret"),
                content: tt(
                    "Turret dispara automaticamente e ajuda no controle defensivo.",
                    "Turret fires automatically and helps defensive control.",
                    "Turret dispara automaticamente y ayuda en el control defensivo."
                ),
                action: tt(
                    "Objetivo: clique no icone de Turret (Simple ou Sniper).",
                    "Goal: click a Turret icon (Simple or Sniper).",
                    "Objetivo: haz clic en un icono de Turret (Simple o Sniper)."
                ),
                targetBuildingType: BuildingTypes.SIMPLE_TURRET,
                pointerText: tt("Selecione uma Turret", "Select a Turret", "Selecciona una Turret")
            },
            {
                key: "turret",
                title: tt("Construir Turret", "Build Turret", "Construir Turret"),
                content: tt(
                    "Posicione Turret para cobrir suas paredes e proteger area vulneravel.",
                    "Place a Turret to cover your walls and protect weak areas.",
                    "Coloca Turret para cubrir tus walls y proteger zonas vulnerables."
                ),
                action: tt("Objetivo: coloque 1 Turret.", "Goal: place 1 Turret.", "Objetivo: coloca 1 Turret."),
                targetBuildingType: BuildingTypes.SIMPLE_TURRET,
                pointerText: tt("Coloque uma Turret", "Place a Turret", "Coloca una Turret")
            },
            {
                key: "select_sniper",
                title: tt("Selecionar Sniper Turret", "Select Sniper Turret", "Seleccionar Sniper Turret"),
                content: tt(
                    "Sniper Turret tem alcance alto e ajuda a segurar pressao de longe.",
                    "Sniper Turret has long range and helps hold pressure from far away.",
                    "Sniper Turret tiene largo alcance y ayuda a aguantar presion desde lejos."
                ),
                action: tt("Objetivo: clique no icone de Sniper Turret.", "Goal: click the Sniper Turret icon.", "Objetivo: haz clic en el icono de Sniper Turret."),
                targetBuildingType: BuildingTypes.SNIPER_TURRET,
                pointerText: tt("Clique na Sniper", "Click Sniper Turret", "Haz clic en Sniper Turret")
            },
            {
                key: "sniper",
                title: tt("Construir Sniper Turret", "Build Sniper Turret", "Construir Sniper Turret"),
                content: tt(
                    "Use sniper para cobertura de longo alcance e controle de aproximacoes.",
                    "Use sniper for long-range coverage and approach control.",
                    "Usa sniper para cobertura de largo alcance y control de aproximaciones."
                ),
                action: tt("Objetivo: coloque 1 Sniper Turret.", "Goal: place 1 Sniper Turret.", "Objetivo: coloca 1 Sniper Turret."),
                targetBuildingType: BuildingTypes.SNIPER_TURRET,
                pointerText: tt("Posicione a Sniper", "Place Sniper Turret", "Coloca Sniper Turret")
            },
            {
                key: "top_menu",
                title: tt("Menu Superior", "Top Menu", "Menu Superior"),
                content: tt(
                    "No topo voce acessa atalhos rapidos de macro como Defend, Save/Load e mais.",
                    "At the top you can access macro shortcuts like Defend, Save/Load and more.",
                    "En la parte superior accedes a atajos macro como Defend, Save/Load y mas."
                ),
                action: tt("Objetivo: abra o menu superior clicando em MENU.", "Goal: open the top menu by clicking MENU.", "Objetivo: abre el menu superior haciendo clic en MENU."),
                targetSelector: "#top-menu-pulltab",
                pointerText: tt("Abra o menu aqui", "Open menu here", "Abre el menu aqui"),
                closeTopMenu: true
            },
            {
                key: "defend",
                title: "Defend",
                content: tt(
                    "Defend salva seu layout e permite teclas de defesa/remount para reconstruir mais rapido.",
                    "Defend saves your layout and enables defense/remount hotkeys for faster rebuilding.",
                    "Defend guarda tu layout y habilita teclas de defensa/remount para reconstruir mas rapido."
                ),
                action: tt("Objetivo: clique em Defend e conclua o salvamento.", "Goal: click Defend and complete the save flow.", "Objetivo: haz clic en Defend y completa el guardado."),
                targetSelector: "#top-defend-btn",
                pointerText: tt("Clique em Defend", "Click Defend", "Haz clic en Defend"),
                openTopMenu: true
            },
            {
                key: "save_base",
                title: "Save Base",
                content: tt(
                    "Save Base salva seu layout atual para carregar depois com um clique/atalho.",
                    "Save Base stores your current layout so you can load it later with one click/hotkey.",
                    "Save Base guarda tu layout actual para cargarlo despues con un clic/atajo."
                ),
                action: tt("Objetivo: clique em Save Base e abra a tela de salvar.", "Goal: click Save Base and open the save screen.", "Objetivo: haz clic en Save Base y abre la pantalla de guardado."),
                targetSelector: "#top-save-base-btn",
                pointerText: tt("Clique em Save Base", "Click Save Base", "Haz clic en Save Base"),
                openTopMenu: true
            },
            {
                key: "load_base",
                title: "Load Base",
                content: tt("Load Base permite carregar layouts salvos (locais/publicos).", "Load Base lets you load saved layouts (local/public).", "Load Base permite cargar layouts guardados (local/publico)."),
                action: tt("Objetivo: clique em Load Base para abrir o menu.", "Goal: click Load Base to open the menu.", "Objetivo: haz clic en Load Base para abrir el menu."),
                targetSelector: "#top-load-base-btn",
                pointerText: tt("Clique em Load Base", "Click Load Base", "Haz clic en Load Base"),
                openTopMenu: true
            },
            {
                key: "theme_menu",
                title: "Theme",
                content: tt("No Theme voce ajusta aparencia e configuracoes visuais da partida.", "In Theme you adjust appearance and visual settings for the match.", "En Theme ajustas apariencia y configuraciones visuales de la partida."),
                action: tt("Objetivo: clique em Theme para abrir configuracoes.", "Goal: click Theme to open settings.", "Objetivo: haz clic en Theme para abrir configuraciones."),
                targetSelector: "#top-theme-btn",
                pointerText: tt("Clique em Theme", "Click Theme", "Haz clic en Theme"),
                openTopMenu: true
            },
            {
                key: "autogens",
                title: "Autogens",
                content: tt("Autogens tenta colocar geradores automaticamente para acelerar economia.", "Autogens tries to place generators automatically to speed up your economy.", "Autogens intenta colocar generators automaticamente para acelerar la economia."),
                action: tt("Objetivo: clique em Autogens.", "Goal: click Autogens.", "Objetivo: haz clic en Autogens."),
                targetSelector: "#top-autogens-btn",
                pointerText: tt("Clique em Autogens", "Click Autogens", "Haz clic en Autogens"),
                openTopMenu: true
            },
            {
                key: "externatk",
                title: "ExternaTK",
                content: tt("ExternaTK monta um padrao externo focado em pressao e controle de mapa.", "ExternaTK builds an outer pattern focused on pressure and map control.", "ExternaTK arma un patron externo enfocado en presion y control de mapa."),
                action: tt("Objetivo: clique em ExternaTK.", "Goal: click ExternaTK.", "Objetivo: haz clic en ExternaTK."),
                targetSelector: "#top-externatk-btn",
                pointerText: tt("Clique em ExternaTK", "Click ExternaTK", "Haz clic en ExternaTK"),
                openTopMenu: true
            },
            {
                key: "select_barracks",
                title: tt("Selecionar Barracks", "Select Barracks", "Seleccionar Barracks"),
                content: tt(
                    "Barracks produz tropas. Sem ela, voce nao consegue pressionar o inimigo.",
                    "Barracks produces troops. Without it, you cannot pressure the enemy.",
                    "Barracks produce tropas. Sin ella no puedes presionar al enemigo."
                ),
                action: tt("Objetivo: clique no icone de Barracks.", "Goal: click the Barracks icon.", "Objetivo: haz clic en el icono de Barracks."),
                targetBuildingType: BuildingTypes.BARRACKS,
                pointerText: tt("Clique na Barracks", "Click Barracks", "Haz clic en Barracks")
            },
            {
                key: "barracks",
                title: tt("Construir Barracks", "Build Barracks", "Construir Barracks"),
                content: tt("Posicione a Barracks para iniciar producao de unidades.", "Place Barracks to start unit production.", "Coloca Barracks para iniciar la produccion de unidades."),
                action: tt("Objetivo: coloque 1 Barracks.", "Goal: place 1 Barracks.", "Objetivo: coloca 1 Barracks."),
                targetBuildingType: BuildingTypes.BARRACKS,
                pointerText: tt("Coloque a Barracks", "Place Barracks", "Coloca Barracks")
            },
            {
                key: "select_armory",
                title: tt("Selecionar Armory", "Select Armory", "Seleccionar Armory"),
                content: tt("Armory libera upgrades de unidades para melhorar seu exercito.", "Armory unlocks unit upgrades to improve your army.", "Armory desbloquea upgrades de unidades para mejorar tu ejercito."),
                action: tt("Objetivo: clique no icone de Armory.", "Goal: click the Armory icon.", "Objetivo: haz clic en el icono de Armory."),
                targetBuildingType: BuildingTypes.ARMORY,
                pointerText: tt("Clique na Armory", "Click Armory", "Haz clic en Armory")
            },
            {
                key: "armory",
                title: tt("Construir Armory", "Build Armory", "Construir Armory"),
                content: tt("Com Armory voce evolui tropas (dano, mobilidade, resistencia etc.).", "With Armory, you upgrade troops (damage, mobility, durability, etc.).", "Con Armory mejoras tropas (dano, movilidad, resistencia, etc.)."),
                action: tt("Objetivo: coloque 1 Armory.", "Goal: place 1 Armory.", "Objetivo: coloca 1 Armory."),
                targetBuildingType: BuildingTypes.ARMORY,
                pointerText: tt("Posicione a Armory", "Place Armory", "Coloca Armory")
            },
            {
                key: "open_core_upgrades",
                title: tt("Painel do Core", "Core Panel", "Panel del Core"),
                content: tt("Clique no nucleo da sua base para abrir upgrades globais.", "Click your base core to open global upgrades.", "Haz clic en el nucleo de tu base para abrir mejoras globales."),
                action: tt("Objetivo: abra o painel do Core clicando no centro da sua base.", "Goal: open the Core panel by clicking your base center.", "Objetivo: abre el panel del Core haciendo clic en el centro de tu base."),
                targetSelector: "#upgrade-container",
                pointerText: tt("Abra upgrades do Core", "Open Core upgrades", "Abre mejoras del Core")
            },
            {
                key: "commander_buy",
                title: tt("Comprar Commander", "Buy Commander", "Comprar Commander"),
                content: tt("Commander e unidade forte para liderar ataques e suporte de linha de frente.", "Commander is a strong unit for leading attacks and frontline support.", "Commander es una unidad fuerte para liderar ataques y soporte de primera linea."),
                action: tt("Objetivo: compre Commander no painel do Core.", "Goal: buy Commander in the Core panel.", "Objetivo: compra Commander en el panel del Core."),
                targetSelector: "#upgrade-container",
                pointerText: tt("Compre o Commander", "Buy Commander", "Compra Commander")
            },
            {
                key: "upgrade_any",
                title: tt("Como Fazer Upgrade", "How to Upgrade", "Como Mejorar"),
                content: tt("Selecione uma construcao e clique em um upgrade no painel lateral.", "Select a building and click an upgrade in the side panel.", "Selecciona una construccion y haz clic en una mejora del panel lateral."),
                action: tt("Objetivo: aplique 1 upgrade em qualquer construcao.", "Goal: apply 1 upgrade to any building.", "Objetivo: aplica 1 mejora en cualquier construccion."),
                targetSelector: "#upgrade-container",
                pointerText: tt("Clique em um upgrade", "Click an upgrade", "Haz clic en una mejora")
            },
            {
                key: "sell_any",
                title: tt("Como Vender", "How to Sell", "Como Vender"),
                content: tt("Selecione construcoes e use Destroy/Sell All para recuperar parte do Power.", "Select buildings and use Destroy/Sell All to recover part of your Power.", "Selecciona construcciones y usa Destroy/Sell All para recuperar parte del Power."),
                action: tt("Objetivo: venda 1 construcao com Destroy ou Sell All.", "Goal: sell 1 building with Destroy or Sell All.", "Objetivo: vende 1 construccion con Destroy o Sell All."),
                targetSelector: "#destroy-button",
                pointerText: tt("Use Destroy/Sell All", "Use Destroy/Sell All", "Usa Destroy/Sell All")
            },
            {
                key: "unit_select",
                title: tt("Selecionar Tropas", "Select Troops", "Seleccionar Tropas"),
                content: tt("Quando tropas nascerem, selecione com Q ou caixa de selecao com o mouse.", "When troops spawn, select them with Q or with mouse drag selection.", "Cuando aparezcan tropas, seleccionalas con Q o con caja de seleccion del mouse."),
                action: tt("Objetivo: selecione pelo menos 1 unidade.", "Goal: select at least 1 unit.", "Objetivo: selecciona al menos 1 unidad."),
                targetSelector: "#group-units-button",
                pointerText: tt("Selecione suas tropas", "Select your troops", "Selecciona tus tropas")
            },
            {
                key: "unit_move",
                title: tt("Mover Tropas da Base", "Move Troops from Base", "Mover Tropas de la Base"),
                content: tt("Com tropas selecionadas, use botao direito no mapa para enviar soldados.", "With troops selected, right-click the map to send soldiers.", "Con tropas seleccionadas, usa clic derecho en el mapa para enviar soldados."),
                action: tt("Objetivo: envie suas tropas com clique direito.", "Goal: move your troops with right-click.", "Objetivo: mueve tus tropas con clic derecho."),
                targetSelector: "#group-units-button",
                pointerText: tt("Clique direito para mover", "Right-click to move", "Clic derecho para mover")
            },
            {
                key: "group",
                title: "Group Troops",
                content: tt("Group Troops organiza melhor o movimento em bloco.", "Group Troops improves grouped movement control.", "Group Troops mejora el control de movimiento en bloque."),
                action: tt("Objetivo: ative o botao Group Troops.", "Goal: enable the Group Troops button.", "Objetivo: activa el boton Group Troops."),
                targetSelector: "#group-units-button",
                pointerText: tt("Ative Group Troops", "Enable Group Troops", "Activa Group Troops")
            },
            {
                key: "minimap_info",
                title: tt("Leitura de Mapa", "Map Awareness", "Lectura del Mapa"),
                content: tt("Use minimap, chat e leaderboard para tomar decisoes de defesa/ataque.", "Use minimap, chat and leaderboard for defense/attack decisions.", "Usa minimapa, chat y leaderboard para tomar decisiones de defensa/ataque."),
                action: tt("Objetivo: observe os paineis e clique em Proxima.", "Goal: check the panels and click Next.", "Objetivo: observa los paneles y haz clic en Siguiente."),
                targetSelector: "#minimap-container",
                pointerText: tt("Minimap para visao geral", "Minimap for overview", "Minimapa para vision general")
            },
            {
                key: "chat_send",
                title: "Chat",
                content: tt("Use chat para comunicar foco de ataque, defesa e pedidos de ajuda.", "Use chat to coordinate attack focus, defense and help requests.", "Usa el chat para coordinar foco de ataque, defensa y pedidos de ayuda."),
                action: tt("Objetivo: envie 1 mensagem no chat (ex.: 'oi').", "Goal: send 1 chat message (e.g. 'hi').", "Objetivo: envia 1 mensaje en el chat (ej.: 'hola')."),
                targetSelector: "#chat",
                pointerText: tt("Envie uma mensagem", "Send a message", "Envia un mensaje")
            },
            {
                key: "finish",
                title: tt("Tutorial Concluido", "Tutorial Completed", "Tutorial Completado"),
                content: tt("Boa. Voce concluiu os fundamentos: economia, defesa, menu, tropas e controle.", "Nice. You completed the fundamentals: economy, defense, menus, troops and control.", "Bien. Completaste los fundamentos: economia, defensa, menus, tropas y control."),
                action: tt("Objetivo: clique em Encerrar para fechar o painel.", "Goal: click Close to close the panel.", "Objetivo: haz clic en Cerrar para cerrar el panel."),
                pointerText: tt("Pronto para jogar", "Ready to play", "Listo para jugar")
            }
        ];
        this.tutorialIndex = 0;
        this.tutorialLastStepKey = "";
        this.tutorialStepCompletion = {};
        this.tutorialActionMarks = {};
        this.syncGroupTroopsState(false, true);
        this.createTutorialOverlay();
        this.ensureTutorialGuideElements();
        this.showTutorialStep();
        if (this.tutorialPollTimer) clearInterval(this.tutorialPollTimer);
        this.tutorialPollTimer = setInterval(() => this.showTutorialStep(), 250);
        this.notifySystemInfo(this.tutorialText(
            "Tutorial iniciado. Siga os objetivos no painel.",
            "Tutorial started. Follow the objectives on the panel.",
            "Tutorial iniciado. Sigue los objetivos del panel."
        ));
    }

    createTutorialOverlay () {
        if (this.tutorialOverlay && this.tutorialOverlay.isConnected) {
            this.tutorialOverlay.style.display = "flex";
            return;
        }

        const overlay = document.createElement("div");
        overlay.id = "tutorial-overlay";
        overlay.className = "tutorial-overlay";

        const card = document.createElement("div");
        card.className = "tutorial-card";

        const title = document.createElement("h2");
        title.id = "tutorial-title";

        const progress = document.createElement("div");
        progress.id = "tutorial-progress";

        const content = document.createElement("p");
        content.id = "tutorial-content";

        const action = document.createElement("p");
        action.id = "tutorial-action";

        const status = document.createElement("p");
        status.id = "tutorial-status";

        const buttonsRow = document.createElement("div");
        buttonsRow.className = "tutorial-buttons-row";

        const skipBtn = document.createElement("button");
        skipBtn.textContent = this.tutorialText("Pular", "Skip", "Saltar");
        skipBtn.id = "tutorial-skip";
        skipBtn.className = "tutorial-button secondary";

        const nextBtn = document.createElement("button");
        nextBtn.textContent = this.tutorialText("Proxima", "Next", "Siguiente");
        nextBtn.id = "tutorial-next";
        nextBtn.className = "tutorial-button primary";

        const closeBtn = document.createElement("button");
        closeBtn.textContent = this.tutorialText("Encerrar", "Close", "Cerrar");
        closeBtn.id = "tutorial-close";
        closeBtn.className = "tutorial-button ghost";

        buttonsRow.appendChild(skipBtn);
        buttonsRow.appendChild(nextBtn);
        buttonsRow.appendChild(closeBtn);

        card.appendChild(title);
        card.appendChild(progress);
        card.appendChild(content);
        card.appendChild(action);
        card.appendChild(status);
        card.appendChild(buttonsRow);
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        this.tutorialOverlay = overlay;

        skipBtn.addEventListener("click", () => {
            if (!this.tutorialModeActive) return;
            if (this.tutorialIndex < this.tutorialSteps.length - 1) {
                this.tutorialIndex += 1;
                this.showTutorialStep();
            }
        });

        nextBtn.addEventListener("click", () => {
            if (!this.tutorialModeActive) return;
            const progressData = this.getTutorialStepProgress(this.tutorialSteps[this.tutorialIndex]);
            if (!progressData.complete) return;
            if (this.tutorialIndex < this.tutorialSteps.length - 1) {
                this.tutorialIndex += 1;
                this.showTutorialStep();
            } else {
                this.closeTutorial();
            }
        });

        closeBtn.addEventListener("click", () => this.closeTutorial());
    }

    ensureTutorialGuideElements () {
        if (!this.tutorialFocusRing || !this.tutorialFocusRing.isConnected) {
            const focusRing = document.createElement("div");
            focusRing.id = "tutorial-focus-ring";
            focusRing.style.display = "none";
            document.body.appendChild(focusRing);
            this.tutorialFocusRing = focusRing;
        }

        if (!this.tutorialStepPointer || !this.tutorialStepPointer.isConnected) {
            const pointer = document.createElement("div");
            pointer.id = "tutorial-step-pointer";
            pointer.style.display = "none";

            const label = document.createElement("span");
            label.className = "tutorial-step-pointer-label";
            pointer.appendChild(label);

            document.body.appendChild(pointer);
            this.tutorialStepPointer = pointer;
        }
    }

    resolveTutorialStepTarget (step) {
        if (!step) return null;

        const candidates = [];
        if (Number.isFinite(Number(step.targetBuildingType))) {
            candidates.push(`#toolbar-container [data-building-type="${Number(step.targetBuildingType)}"]`);
        }
        if (typeof step.targetSelector === "string" && step.targetSelector.trim()) {
            candidates.push(step.targetSelector.trim());
        }

        for (const selector of candidates) {
            try {
                const found = document.querySelector(selector);
                if (found) return found;
            } catch (error) {}
        }

        return null;
    }

    clearTutorialGuides () {
        if (this.tutorialCurrentTarget?.classList) {
            this.tutorialCurrentTarget.classList.remove("tutorial-target-highlight");
        }
        this.tutorialCurrentTarget = null;

        if (this.tutorialFocusRing) {
            this.tutorialFocusRing.style.display = "none";
        }
        if (this.tutorialStepPointer) {
            this.tutorialStepPointer.style.display = "none";
        }
    }

    positionTutorialGuides (step, target) {
        this.ensureTutorialGuideElements();
        if (!this.tutorialFocusRing || !this.tutorialStepPointer || !target) {
            this.clearTutorialGuides();
            return;
        }

        if (this.tutorialCurrentTarget && this.tutorialCurrentTarget !== target) {
            this.tutorialCurrentTarget.classList.remove("tutorial-target-highlight");
        }

        this.tutorialCurrentTarget = target;
        target.classList.add("tutorial-target-highlight");

        const rect = target.getBoundingClientRect();
        if (!rect || rect.width < 2 || rect.height < 2) {
            this.clearTutorialGuides();
            return;
        }

        const padding = 8;
        const ringLeft = Math.max(4, rect.left - padding);
        const ringTop = Math.max(4, rect.top - padding);
        const ringWidth = Math.min(window.innerWidth - ringLeft - 4, rect.width + padding * 2);
        const ringHeight = Math.min(window.innerHeight - ringTop - 4, rect.height + padding * 2);

        this.tutorialFocusRing.style.display = "block";
        this.tutorialFocusRing.style.left = `${ringLeft}px`;
        this.tutorialFocusRing.style.top = `${ringTop}px`;
        this.tutorialFocusRing.style.width = `${Math.max(12, ringWidth)}px`;
        this.tutorialFocusRing.style.height = `${Math.max(12, ringHeight)}px`;

        const pointerLabel = this.tutorialStepPointer.querySelector(".tutorial-step-pointer-label");
        if (pointerLabel) {
            pointerLabel.textContent = step?.pointerText
                || step?.action
                || this.tutorialText("Siga esta etapa", "Follow this step", "Sigue este paso");
        }

        this.tutorialStepPointer.style.display = "flex";
        this.tutorialStepPointer.style.left = "-9999px";
        this.tutorialStepPointer.style.top = "-9999px";
        this.tutorialStepPointer.style.maxWidth = `${Math.max(170, Math.min(300, window.innerWidth - 20))}px`;
        this.tutorialStepPointer.dataset.placement = "top";

        const pointerRect = this.tutorialStepPointer.getBoundingClientRect();
        const pointerWidth = Math.max(170, pointerRect.width);
        const pointerHeight = Math.max(36, pointerRect.height);

        let placement = String(step?.pointerPlacement || "top").toLowerCase();
        if (!["top", "bottom"].includes(placement)) placement = "top";

        let pointerLeft = rect.left + (rect.width / 2) - (pointerWidth / 2);
        pointerLeft = Math.min(
            Math.max(8, pointerLeft),
            Math.max(8, window.innerWidth - pointerWidth - 8)
        );

        let pointerTop = placement === "bottom"
            ? rect.bottom + 14
            : rect.top - pointerHeight - 14;

        if (placement === "top" && pointerTop < 8) {
            placement = "bottom";
            pointerTop = rect.bottom + 14;
        } else if (placement === "bottom" && (pointerTop + pointerHeight) > (window.innerHeight - 8)) {
            placement = "top";
            pointerTop = rect.top - pointerHeight - 14;
        }

        pointerTop = Math.min(
            Math.max(8, pointerTop),
            Math.max(8, window.innerHeight - pointerHeight - 8)
        );

        this.tutorialStepPointer.dataset.placement = placement;
        this.tutorialStepPointer.style.left = `${pointerLeft}px`;
        this.tutorialStepPointer.style.top = `${pointerTop}px`;
    }

    showTutorialStep () {
        if (!this.tutorialOverlay || !this.tutorialModeActive) return;

        const step = this.tutorialSteps && this.tutorialSteps[this.tutorialIndex];
        if (!step) return;

        const title = document.getElementById("tutorial-title");
        const progress = document.getElementById("tutorial-progress");
        const content = document.getElementById("tutorial-content");
        const action = document.getElementById("tutorial-action");
        const status = document.getElementById("tutorial-status");
        const skipBtn = document.getElementById("tutorial-skip");
        const nextBtn = document.getElementById("tutorial-next");
        const closeBtn = document.getElementById("tutorial-close");
        let progressData = this.getTutorialStepProgress(step);
        const stepChanged = this.tutorialLastStepKey !== step.key;

        if (progressData.complete && step?.key && step.key !== "finish") {
            this.tutorialStepCompletion[step.key] = true;
        } else if (!progressData.complete && this.tutorialStepCompletion?.[step?.key]) {
            progressData = {
                complete: true,
                status: this.tutorialText(
                    "Concluido: etapa ja registrada.",
                    "Completed: step already recorded.",
                    "Completado: etapa ya registrada."
                )
            };
        }

        if (stepChanged) {
            if (step.closeTopMenu && typeof this._autoBuildShowMenu === "function") {
                this._autoBuildShowMenu();
            }
            if (step.openTopMenu && typeof this._autoBuildShowActions === "function") {
                this._autoBuildShowActions();
            }
            this.tutorialLastStepKey = step.key || "";
        }

        if (title) title.textContent = `${this.tutorialText("Tutorial", "Tutorial", "Tutorial")}: ${step.title}`;
        if (progress) {
            progress.textContent = this.tutorialText(
                `Etapa ${this.tutorialIndex + 1} de ${this.tutorialSteps.length}`,
                `Step ${this.tutorialIndex + 1} of ${this.tutorialSteps.length}`,
                `Paso ${this.tutorialIndex + 1} de ${this.tutorialSteps.length}`
            );
        }
        if (content) content.textContent = step.content;
        if (action) action.textContent = step.action;
        if (status) status.textContent = progressData.status;

        const target = this.resolveTutorialStepTarget(step);
        if (target) {
            this.positionTutorialGuides(step, target);
        } else {
            this.clearTutorialGuides();
        }

        if (skipBtn) {
            skipBtn.textContent = this.tutorialText("Pular", "Skip", "Saltar");
            skipBtn.style.display = this.tutorialIndex < this.tutorialSteps.length - 1 ? "inline-flex" : "none";
        }
        if (nextBtn) {
            if (this.tutorialIndex < this.tutorialSteps.length - 1) {
                nextBtn.textContent = this.tutorialText("Proxima", "Next", "Siguiente");
                nextBtn.disabled = !progressData.complete;
                nextBtn.style.opacity = progressData.complete ? "1" : "0.6";
            } else {
                nextBtn.textContent = this.tutorialText("Concluido", "Completed", "Completado");
                nextBtn.disabled = true;
                nextBtn.style.opacity = "0.7";
            }
        }
        if (closeBtn) {
            closeBtn.textContent = this.tutorialText("Encerrar", "Close", "Cerrar");
        }
    }

    getTutorialStepProgress (step) {
        if (!step) {
            return { complete: false, status: "" };
        }

        const player = this.core?.gameManager?.player;
        const opponents = Array.isArray(this.core?.gameManager?.players)
            ? this.core.gameManager.players.filter((enemy) => enemy && !enemy.removeFlag)
            : [];
        const camera = this.core?.camera;
        const baseline = this.tutorialBaselineCounts || {
            generator: 0,
            wall: 0,
            turret: 0,
            barracks: 0,
            house: 0,
            armory: 0,
            sniperTurret: 0
        };
        const selectedPlacementType = Number(this.core?.buildingManager?.selectedPlacementType);
        const selectedUnits = this.core?.unitManager?.selectedUnits || [];
        const totalUnits = Array.isArray(player?.units) ? player.units.length : 0;
        const movedUnitsAfterTutorialStart = Number(this.core?.unitManager?.lastMoveCommandAt || 0) > this.tutorialStartedAt;
        const actionsPanel = document.getElementById("top-menu-actions-panel");
        const actionsDisplay = actionsPanel
            ? (actionsPanel.style.display || window.getComputedStyle(actionsPanel).display)
            : "none";
        const settingsPanel = this.DOM?.settings?.panel;
        const settingsDisplay = settingsPanel
            ? (settingsPanel.style.display || window.getComputedStyle(settingsPanel).display)
            : "none";
        const actionMarks = this.tutorialActionMarks || {};
        const tt = (pt, en, es) => this.tutorialText(pt, en, es);

        const countByTypes = (types) => {
            if (!player) return 0;
            const list = Array.isArray(types) ? types : [types];
            const wanted = new Set(list.map((type) => Number(type)));
            return (player.buildings || []).reduce((count, building) => {
                if (!building || building.removeFlag) return count;
                return wanted.has(Number(building.type)) ? count + 1 : count;
            }, 0);
        };

        switch (step.key) {
        case "intro":
            return { complete: true, status: tt("Leia o resumo e avance quando quiser.", "Read the summary and continue when ready.", "Lee el resumen y avanza cuando quieras.") };
        case "enemy": {
            const count = opponents.length;
            const complete = count > 0;
            const status = complete
                ? tt(
                    `Concluido: ${count} oponente(s) detectado(s) na partida.`,
                    `Completed: ${count} opponent(s) detected in the match.`,
                    `Completado: ${count} oponente(s) detectado(s) en la partida.`
                )
                : tt(
                    "Aguardando oponente aparecer (normalmente bot do servidor).",
                    "Waiting for an opponent to appear (usually a server bot).",
                    "Esperando que aparezca un oponente (normalmente un bot del servidor)."
                );
            return { complete, status };
        }
        case "nick_focus": {
            const complete = Number(actionMarks.leaderboardNickAt || 0) > this.tutorialStartedAt;
            const status = complete
                ? tt("Concluido: camera focada pelo nick.", "Completed: camera focused by nickname.", "Completado: camara enfocada por nick.")
                : tt("Clique no nick de algum jogador no leaderboard.", "Click a player's nickname in the leaderboard.", "Haz clic en el nick de algun jugador en el leaderboard.");
            return { complete, status };
        }
        case "camera": {
            const start = this.tutorialInitialCameraState || { x: 0, y: 0, zoom: 1 };
            const currentX = Number(camera?.targetPosition?.x) || Number(camera?.x) || 0;
            const currentY = Number(camera?.targetPosition?.y) || Number(camera?.y) || 0;
            const distance = Math.hypot(currentX - start.x, currentY - start.y);
            const complete = distance >= 70;
            const status = complete
                ? tt("Concluido: camera movimentada.", "Completed: camera moved.", "Completado: camara movida.")
                : tt("Use WASD/setas ou arraste com mouse para mover camera.", "Use WASD/arrows or drag with mouse to move the camera.", "Usa WASD/flechas o arrastra con el mouse para mover la camara.");
            return { complete, status };
        }
        case "power_info":
            return { complete: true, status: tt("Power observado. Avance para construir.", "Power checked. Continue to building.", "Power revisado. Continua para construir.") };
        case "select_generator": {
            const complete = selectedPlacementType === Number(BuildingTypes.GENERATOR);
            const status = complete
                ? tt("Concluido: Generator selecionado.", "Completed: Generator selected.", "Completado: Generator seleccionado.")
                : tt("Clique no icone de Generator no toolbar.", "Click the Generator icon on the toolbar.", "Haz clic en el icono de Generator en la barra.");
            return { complete, status };
        }
        case "generator": {
            const current = countByTypes(BuildingTypes.GENERATOR);
            const complete = current > baseline.generator;
            const status = complete
                ? tt("Concluido: Generator construido.", "Completed: Generator built.", "Completado: Generator construido.")
                : tt(
                    `Faltando: construa 1 Generator (${Math.max(0, baseline.generator + 1 - current)} restante).`,
                    `Remaining: build 1 Generator (${Math.max(0, baseline.generator + 1 - current)} left).`,
                    `Falta: construye 1 Generator (${Math.max(0, baseline.generator + 1 - current)} restante).`
                );
            return { complete, status };
        }
        case "select_house": {
            const complete = selectedPlacementType === Number(BuildingTypes.HOUSE);
            const status = complete
                ? tt("Concluido: House selecionada.", "Completed: House selected.", "Completado: House seleccionada.")
                : tt("Clique no icone de House no toolbar.", "Click the House icon on the toolbar.", "Haz clic en el icono de House en la barra.");
            return { complete, status };
        }
        case "house": {
            const current = countByTypes(BuildingTypes.HOUSE);
            const complete = current > baseline.house;
            const status = complete
                ? tt("Concluido: House construida.", "Completed: House built.", "Completado: House construida.")
                : tt(
                    `Faltando: construa 1 House (${Math.max(0, baseline.house + 1 - current)} restante).`,
                    `Remaining: build 1 House (${Math.max(0, baseline.house + 1 - current)} left).`,
                    `Falta: construye 1 House (${Math.max(0, baseline.house + 1 - current)} restante).`
                );
            return { complete, status };
        }
        case "select_wall": {
            const complete = selectedPlacementType === Number(BuildingTypes.WALL);
            const status = complete
                ? tt("Concluido: Wall selecionada.", "Completed: Wall selected.", "Completado: Wall seleccionada.")
                : tt("Clique no icone de Wall no toolbar.", "Click the Wall icon on the toolbar.", "Haz clic en el icono de Wall en la barra.");
            return { complete, status };
        }
        case "wall": {
            const current = countByTypes(BuildingTypes.WALL);
            const complete = current > baseline.wall;
            const status = complete
                ? tt("Concluido: Wall construida.", "Completed: Wall built.", "Completado: Wall construida.")
                : tt(
                    `Faltando: construa 1 Wall (${Math.max(0, baseline.wall + 1 - current)} restante).`,
                    `Remaining: build 1 Wall (${Math.max(0, baseline.wall + 1 - current)} left).`,
                    `Falta: construye 1 Wall (${Math.max(0, baseline.wall + 1 - current)} restante).`
                );
            return { complete, status };
        }
        case "select_turret": {
            const complete = selectedPlacementType === Number(BuildingTypes.SIMPLE_TURRET)
                || selectedPlacementType === Number(BuildingTypes.SNIPER_TURRET);
            const status = complete
                ? tt("Concluido: Turret selecionada.", "Completed: Turret selected.", "Completado: Turret seleccionada.")
                : tt("Clique no icone de Turret (Simple ou Sniper).", "Click a Turret icon (Simple or Sniper).", "Haz clic en un icono de Turret (Simple o Sniper).");
            return { complete, status };
        }
        case "turret": {
            const current = countByTypes([BuildingTypes.SIMPLE_TURRET, BuildingTypes.SNIPER_TURRET]);
            const complete = current > baseline.turret;
            const status = complete
                ? tt("Concluido: Turret construida.", "Completed: Turret built.", "Completado: Turret construida.")
                : tt(
                    `Faltando: construa 1 Turret (${Math.max(0, baseline.turret + 1 - current)} restante).`,
                    `Remaining: build 1 Turret (${Math.max(0, baseline.turret + 1 - current)} left).`,
                    `Falta: construye 1 Turret (${Math.max(0, baseline.turret + 1 - current)} restante).`
                );
            return { complete, status };
        }
        case "select_sniper": {
            const complete = selectedPlacementType === Number(BuildingTypes.SNIPER_TURRET);
            const status = complete
                ? tt("Concluido: Sniper Turret selecionada.", "Completed: Sniper Turret selected.", "Completado: Sniper Turret seleccionada.")
                : tt("Clique no icone de Sniper Turret no toolbar.", "Click the Sniper Turret icon on the toolbar.", "Haz clic en el icono de Sniper Turret en la barra.");
            return { complete, status };
        }
        case "sniper": {
            const current = countByTypes(BuildingTypes.SNIPER_TURRET);
            const complete = current > baseline.sniperTurret;
            const status = complete
                ? tt("Concluido: Sniper Turret construida.", "Completed: Sniper Turret built.", "Completado: Sniper Turret construida.")
                : tt(
                    `Faltando: construa 1 Sniper Turret (${Math.max(0, baseline.sniperTurret + 1 - current)} restante).`,
                    `Remaining: build 1 Sniper Turret (${Math.max(0, baseline.sniperTurret + 1 - current)} left).`,
                    `Falta: construye 1 Sniper Turret (${Math.max(0, baseline.sniperTurret + 1 - current)} restante).`
                );
            return { complete, status };
        }
        case "top_menu": {
            const complete = actionsDisplay === "grid"
                || actionsDisplay === "flex"
                || Number(actionMarks.topMenuAt || 0) > this.tutorialStartedAt;
            const status = complete
                ? tt("Concluido: menu superior aberto.", "Completed: top menu opened.", "Completado: menu superior abierto.")
                : tt("Clique no botao MENU no topo para abrir as acoes.", "Click the top MENU button to open actions.", "Haz clic en el boton MENU arriba para abrir acciones.");
            return { complete, status };
        }
        case "defend": {
            const profileCreatedAt = Number(this.core?.buildingManager?.defenseProfile?.createdAt || 0);
            const complete = profileCreatedAt > this.tutorialStartedAt;
            const status = complete
                ? tt("Concluido: Defend salvo com sucesso.", "Completed: Defend saved successfully.", "Completado: Defend guardado correctamente.")
                : tt("Clique em Defend e finalize os prompts de configuracao.", "Click Defend and finish the setup prompts.", "Haz clic en Defend y completa los prompts de configuracion.");
            return { complete, status };
        }
        case "save_base": {
            const dialogOpen = Boolean(this.baseLayoutDialogElement && this.baseLayoutDialogElement.parentNode);
            const clicked = Number(actionMarks.saveBaseAt || 0) > this.tutorialStartedAt;
            const complete = dialogOpen || clicked;
            const status = complete
                ? tt("Concluido: Save Base aberto.", "Completed: Save Base opened.", "Completado: Save Base abierto.")
                : tt("Clique em Save Base para abrir a tela.", "Click Save Base to open the screen.", "Haz clic en Save Base para abrir la pantalla.");
            return { complete, status };
        }
        case "load_base": {
            const dialogOpen = Boolean(this.baseLayoutDialogElement && this.baseLayoutDialogElement.parentNode);
            const clicked = Number(actionMarks.loadBaseAt || 0) > this.tutorialStartedAt;
            const complete = dialogOpen || clicked;
            const status = complete
                ? tt("Concluido: Load Base aberto.", "Completed: Load Base opened.", "Completado: Load Base abierto.")
                : tt("Clique em Load Base para abrir a tela.", "Click Load Base to open the screen.", "Haz clic en Load Base para abrir la pantalla.");
            return { complete, status };
        }
        case "theme_menu": {
            const clicked = Number(actionMarks.themeAt || 0) > this.tutorialStartedAt;
            const panelOpen = settingsDisplay === "flex" || settingsDisplay === "block" || settingsDisplay === "grid";
            const complete = clicked || panelOpen;
            const status = complete
                ? tt("Concluido: Theme aberto.", "Completed: Theme opened.", "Completado: Theme abierto.")
                : tt("Clique em Theme para abrir configuracoes.", "Click Theme to open settings.", "Haz clic en Theme para abrir configuraciones.");
            return { complete, status };
        }
        case "autogens": {
            const clicked = Number(actionMarks.autogensAt || 0) > this.tutorialStartedAt;
            const running = String(this.core?.buildingManager?.autoBuildMode || "") === "autogens";
            const complete = clicked || running;
            const status = complete
                ? tt("Concluido: Autogens acionado.", "Completed: Autogens activated.", "Completado: Autogens activado.")
                : tt("Clique em Autogens no menu superior.", "Click Autogens in the top menu.", "Haz clic en Autogens en el menu superior.");
            return { complete, status };
        }
        case "externatk": {
            const clicked = Number(actionMarks.externatkAt || 0) > this.tutorialStartedAt;
            const running = String(this.core?.buildingManager?.autoBuildMode || "") === "externatk";
            const complete = clicked || running;
            const status = complete
                ? tt("Concluido: ExternaTK acionado.", "Completed: ExternaTK activated.", "Completado: ExternaTK activado.")
                : tt("Clique em ExternaTK no menu superior.", "Click ExternaTK in the top menu.", "Haz clic en ExternaTK en el menu superior.");
            return { complete, status };
        }
        case "select_barracks": {
            const complete = selectedPlacementType === Number(BuildingTypes.BARRACKS);
            const status = complete
                ? tt("Concluido: Barracks selecionada.", "Completed: Barracks selected.", "Completado: Barracks seleccionada.")
                : tt("Clique no icone de Barracks no toolbar.", "Click the Barracks icon on the toolbar.", "Haz clic en el icono de Barracks en la barra.");
            return { complete, status };
        }
        case "barracks": {
            const current = countByTypes(BuildingTypes.BARRACKS);
            const complete = current > baseline.barracks;
            const status = complete
                ? tt("Concluido: Barracks construida.", "Completed: Barracks built.", "Completado: Barracks construida.")
                : tt(
                    `Faltando: construa 1 Barracks (${Math.max(0, baseline.barracks + 1 - current)} restante).`,
                    `Remaining: build 1 Barracks (${Math.max(0, baseline.barracks + 1 - current)} left).`,
                    `Falta: construye 1 Barracks (${Math.max(0, baseline.barracks + 1 - current)} restante).`
                );
            return { complete, status };
        }
        case "select_armory": {
            const complete = selectedPlacementType === Number(BuildingTypes.ARMORY);
            const status = complete
                ? tt("Concluido: Armory selecionada.", "Completed: Armory selected.", "Completado: Armory seleccionada.")
                : tt("Clique no icone de Armory no toolbar.", "Click the Armory icon on the toolbar.", "Haz clic en el icono de Armory en la barra.");
            return { complete, status };
        }
        case "armory": {
            const current = countByTypes(BuildingTypes.ARMORY);
            const complete = current > baseline.armory;
            const status = complete
                ? tt("Concluido: Armory construida.", "Completed: Armory built.", "Completado: Armory construida.")
                : tt(
                    `Faltando: construa 1 Armory (${Math.max(0, baseline.armory + 1 - current)} restante).`,
                    `Remaining: build 1 Armory (${Math.max(0, baseline.armory + 1 - current)} left).`,
                    `Falta: construye 1 Armory (${Math.max(0, baseline.armory + 1 - current)} restante).`
                );
            return { complete, status };
        }
        case "open_core_upgrades": {
            const panel = this.DOM?.game?.upgrades?.container;
            const visible = panel && panel.style.display !== "none";
            const mode = String(panel?.dataset?.mode || "");
            const complete = Boolean(visible && mode === "core");
            const status = complete
                ? tt("Concluido: painel do Core aberto.", "Completed: Core panel opened.", "Completado: panel del Core abierto.")
                : tt("Clique no nucleo da sua base para abrir os upgrades do Core.", "Click your base core to open Core upgrades.", "Haz clic en el nucleo de tu base para abrir mejoras del Core.");
            return { complete, status };
        }
        case "commander_buy": {
            const complete = Boolean(this.core?.gameManager?.hasCommander)
                || Number(actionMarks.commanderBuyAt || 0) > this.tutorialStartedAt;
            const status = complete
                ? tt("Concluido: compra do Commander registrada.", "Completed: Commander purchase registered.", "Completado: compra de Commander registrada.")
                : tt("Compre Commander no painel do Core.", "Buy Commander in the Core panel.", "Compra Commander en el panel del Core.");
            return { complete, status };
        }
        case "upgrade_any": {
            const complete = Number(actionMarks.buildingUpgradeAt || 0) > this.tutorialStartedAt
                || Number(actionMarks.coreUpgradeAt || 0) > this.tutorialStartedAt;
            const status = complete
                ? tt("Concluido: upgrade aplicado.", "Completed: upgrade applied.", "Completado: mejora aplicada.")
                : tt("Selecione algo e aplique 1 upgrade no painel lateral.", "Select something and apply 1 upgrade in the side panel.", "Selecciona algo y aplica 1 mejora en el panel lateral.");
            return { complete, status };
        }
        case "sell_any": {
            const complete = Number(actionMarks.sellAt || 0) > this.tutorialStartedAt;
            const status = complete
                ? tt("Concluido: venda registrada.", "Completed: sale registered.", "Completado: venta registrada.")
                : tt("Use Destroy ou Sell All para vender.", "Use Destroy or Sell All to sell.", "Usa Destroy o Sell All para vender.");
            return { complete, status };
        }
        case "unit_select": {
            const selectedCount = Array.isArray(selectedUnits) ? selectedUnits.length : 0;
            const complete = selectedCount > 0;
            let status = "";
            if (complete) {
                status = tt(
                    `Concluido: ${selectedCount} unidade(s) selecionada(s).`,
                    `Completed: ${selectedCount} unit(s) selected.`,
                    `Completado: ${selectedCount} unidad(es) seleccionada(s).`
                );
            } else if (totalUnits <= 0) {
                status = tt("Aguardando tropas nascerem na Barracks...", "Waiting for troops to spawn in Barracks...", "Esperando que nazcan tropas en Barracks...");
            } else {
                status = tt("Selecione tropas (Q ou caixa de selecao).", "Select troops (Q or drag-select box).", "Selecciona tropas (Q o caja de seleccion).");
            }
            return { complete, status };
        }
        case "unit_move": {
            const complete = movedUnitsAfterTutorialStart;
            const status = complete
                ? tt("Concluido: comando de movimento enviado.", "Completed: move command sent.", "Completado: comando de movimiento enviado.")
                : tt("Com tropas selecionadas, use clique direito no mapa para mover.", "With troops selected, use right-click on the map to move.", "Con tropas seleccionadas, usa clic derecho en el mapa para mover.");
            return { complete, status };
        }
        case "group": {
            const complete = Boolean(this.groupUnitsActive);
            const status = complete
                ? tt("Concluido: Group Troops ativado.", "Completed: Group Troops enabled.", "Completado: Group Troops activado.")
                : tt("Ative o botao Group Troops para continuar.", "Enable the Group Troops button to continue.", "Activa el boton Group Troops para continuar.");
            return { complete, status };
        }
        case "minimap_info":
            return { complete: true, status: tt("Minimap e paineis observados. Avance para concluir.", "Minimap and panels checked. Continue to finish.", "Minimapa y paneles revisados. Continua para finalizar.") };
        case "chat_send": {
            const complete = Number(actionMarks.chatAt || 0) > this.tutorialStartedAt;
            const status = complete
                ? tt("Concluido: mensagem enviada no chat.", "Completed: chat message sent.", "Completado: mensaje enviado en el chat.")
                : tt("Envie 1 mensagem no chat para concluir.", "Send 1 chat message to complete.", "Envia 1 mensaje en el chat para completar.");
            return { complete, status };
        }
        case "finish":
            return { complete: false, status: tt("Tutorial finalizado. Continue treinando em partidas reais.", "Tutorial finished. Keep practicing in real matches.", "Tutorial finalizado. Sigue practicando en partidas reales.") };
        default:
            return { complete: false, status: "" };
        }
    }

    closeTutorial (options = {}) {
        const { silent = false } = options || {};
        this.tutorialModeActive = false;
        if (this.tutorialPollTimer) {
            clearInterval(this.tutorialPollTimer);
            this.tutorialPollTimer = null;
        }
        this.tutorialLastStepKey = "";
        this.tutorialStepCompletion = {};
        this.tutorialActionMarks = {};
        this.clearTutorialGuides();
        if (this.tutorialOverlay) {
            this.tutorialOverlay.style.display = "none";
        }
        if (!silent) {
            this.notifySystemInfo(this.tutorialText(
                "Tutorial encerrado. Voce pode continuar jogando normalmente.",
                "Tutorial closed. You can keep playing normally.",
                "Tutorial cerrado. Puedes seguir jugando normalmente."
            ));
        }
    }

    addSkinLibraryButtonListener () {
        if (this.DOM.skins.libraryExit) {
            this.DOM.skins.libraryExit.addEventListener("click", () => {
                this.showSkinLibraryDialog(false);
            });
        }
    }

    addMenuShortcutLinks () {
        const bindDiscordLink = (id) => {
            const button = document.getElementById(id);
            if (!button || button.dataset.boundDiscordLink) return;
            button.dataset.boundDiscordLink = "1";
            button.addEventListener("click", () => {
                window.open("https://discord.gg/YAEG9qJGMh", "_blank", "noopener,noreferrer");
            });
        };

        bindDiscordLink("discord-button");
        bindDiscordLink("discord-open-button");
    }

    addLegalDialogListeners () {
        const legal = this.DOM?.legal;
        if (!legal) return;

        const bindDialog = (openBtn, dialog, closeBtn) => {
            if (!openBtn || !dialog) return;
            const closeDialog = () => {
                dialog.style.display = "none";
            };
            openBtn.addEventListener("click", () => {
                dialog.style.display = "flex";
            });
            if (closeBtn) {
                closeBtn.addEventListener("click", closeDialog);
            }
            dialog.addEventListener("click", (event) => {
                if (event.target === dialog) {
                    closeDialog();
                }
            });
        };

        bindDialog(legal.changelogOpenButton, legal.changelogDialog, legal.changelogCloseButton);
        bindDialog(legal.privacyOpenButton, legal.privacyDialog, legal.privacyCloseButton);
        bindDialog(legal.termsOpenButton, legal.termsDialog, legal.termsCloseButton);
        bindDialog(legal.aboutOpenButton, legal.aboutDialog, legal.aboutCloseButton);
    }

    getChangelogByLanguage () {
        return {
            pt: [
                {
                    date: "16/03/2026",
                    title: "Sistema de Upgrade e Sell All",
                    notes: [
                        "Novo modo Auto Upgrade para evoluir estruturas de forma automatica.",
                        "Sell All expandido para facilitar a limpeza da base em massa.",
                        "Fluxo de upgrade ajustado para todos os itens com melhor consistencia visual."
                    ]
                },
                {
                    date: "16/03/2026",
                    title: "Pontuacao e progresso em partida",
                    notes: [
                        "Corrigido bug de pontuacao ao sair da area de protecao.",
                        "Ganho de pontos voltou ao comportamento esperado durante a partida."
                    ]
                },
                {
                    date: "16/03/2026",
                    title: "Autogens e Full ATK",
                    notes: [
                        "Novo formato de Auto Gens para layout mais padrao.",
                        "Modelo de base Full ATK refinado com ajustes de nucleo e objetos."
                    ]
                },
                {
                    date: "15/03/2026",
                    title: "Defesa e construcao",
                    notes: [
                        "Sistema de defesa melhorado com logica inspirada em layouts veteranos.",
                        "Tecla R agora rotaciona Generator e House para novos formatos de base."
                    ]
                },
                {
                    date: "15/03/2026",
                    title: "Combate e qualidade de vida",
                    notes: [
                        "Adicionada arma com 3 disparos para aumentar dificuldade e variedade.",
                        "Corrigido bug visual de linhas e tela rapida ao entrar no jogo."
                    ]
                }
            ],
            en: [
                {
                    date: "2026-03-16",
                    title: "Upgrade and Sell All System",
                    notes: [
                        "Added Auto Upgrade mode for automated structure upgrades.",
                        "Expanded Sell All behavior for faster base cleanup.",
                        "Upgrade flow polished across all item categories."
                    ]
                },
                {
                    date: "2026-03-16",
                    title: "Scoring and match progression",
                    notes: [
                        "Fixed score gain issue after leaving protection range.",
                        "Point progression now behaves as expected during gameplay."
                    ]
                },
                {
                    date: "2026-03-16",
                    title: "Autogens and Full ATK layout",
                    notes: [
                        "Introduced a new Auto Gens format for a cleaner standard pattern.",
                        "Refined Full ATK base model with core and object size adjustments."
                    ]
                },
                {
                    date: "2026-03-15",
                    title: "Defense and building flow",
                    notes: [
                        "Defense logic improved to match veteran-style base patterns.",
                        "R key now rotates Generator and House for better fitting layouts."
                    ]
                },
                {
                    date: "2026-03-15",
                    title: "Combat and stability updates",
                    notes: [
                        "Added a 3-shot weapon to increase pressure and combat variety.",
                        "Fixed line-visibility and fast-entry screen issues."
                    ]
                }
            ],
            es: [
                {
                    date: "16/03/2026",
                    title: "Sistema de Upgrade y Sell All",
                    notes: [
                        "Se agrego Auto Upgrade para mejorar estructuras automaticamente.",
                        "Sell All fue ampliado para limpiar la base mas rapido.",
                        "Se ajusto el flujo de mejoras para todos los tipos de items."
                    ]
                },
                {
                    date: "16/03/2026",
                    title: "Puntuacion y progreso de partida",
                    notes: [
                        "Corregido el bug de puntuacion al salir del area de proteccion.",
                        "La ganancia de puntos vuelve a funcionar como se esperaba."
                    ]
                },
                {
                    date: "16/03/2026",
                    title: "Autogens y layout Full ATK",
                    notes: [
                        "Nuevo formato de Auto Gens para un patron mas estandar.",
                        "Mejoras en el modelo Full ATK con ajustes de nucleo y objetos."
                    ]
                },
                {
                    date: "15/03/2026",
                    title: "Defensa y construccion",
                    notes: [
                        "Mejorada la logica de defensa con enfoque de bases veteranas.",
                        "La tecla R ahora rota Generator y House para mejores encajes."
                    ]
                },
                {
                    date: "15/03/2026",
                    title: "Combate y estabilidad",
                    notes: [
                        "Nueva arma de 3 disparos para mas dificultad y variacion tactica.",
                        "Corregidos bugs visuales de lineas y pantalla rapida al entrar."
                    ]
                }
            ]
        };
    }

    renderLocalizedChangelog () {
        const container = document.getElementById("changelog-content");
        if (!container) return;

        const language = this.languageManager.getLanguage();
        const changelogByLanguage = this.getChangelogByLanguage();
        const entries = changelogByLanguage[language] || changelogByLanguage.en;

        container.innerHTML = "";

        const creatorsLabel = language === "pt"
            ? "Desenvolvedores"
            : (language === "es" ? "Desarrolladores" : "Developers");
        const creatorsEntry = document.createElement("article");
        creatorsEntry.className = "changelog-entry changelog-creators";
        creatorsEntry.innerHTML = `
            <div class="changelog-date">${creatorsLabel}</div>
            <h3 class="changelog-title">Wilker Junio, Emerson Rodrigues</h3>
        `;
        container.appendChild(creatorsEntry);

        entries.forEach((entry) => {
            const card = document.createElement("article");
            card.className = "changelog-entry";

            const date = document.createElement("div");
            date.className = "changelog-date";
            date.textContent = entry.date;

            const title = document.createElement("h3");
            title.className = "changelog-title";
            title.textContent = entry.title;

            const notes = document.createElement("ul");
            notes.className = "changelog-notes";
            (entry.notes || []).forEach((note) => {
                const item = document.createElement("li");
                item.textContent = note;
                notes.appendChild(item);
            });

            card.appendChild(date);
            card.appendChild(title);
            card.appendChild(notes);
            container.appendChild(card);
        });
    }

    addSettingsPanelListener () {
        // menu settings button should open the same settings panel
        if (this.DOM.menu.menuSettingsButton) {
            this.DOM.menu.menuSettingsButton.addEventListener('click', () => {
                this.showGameSettingsButton(false);
                this.showGameSettingsPanel(true);
            });
        }
        if (this.DOM.settings.button) {
            this.DOM.settings.button.addEventListener("click", () => {
                this.showGameSettingsButton(false)
                this.showGameSettingsPanel(true)
            });
        }

        if (this.DOM.settings.exitButton) {
            this.DOM.settings.exitButton.addEventListener("click", () => {
                this.showGameSettingsButton(false)
                this.closeSettingsAfterChoice()
            });
        }

        this.DOM.settings.themeSelect.addEventListener("change", (event) => {
            this.core.themeManager.applyTheme(event.target.value);
            this.closeSettingsAfterChoice();
        });
    }

    extractPlayerName () {
        const isLoggedIn = this.core.networkManager.loggedIn;
        const userData = this.core.networkManager.userData;
        let baseName = "";

        if (isLoggedIn && userData && userData.nickname) {
            baseName = userData.nickname;
        }

        if (!baseName && isLoggedIn) {
            try {
                const cachedUser = localStorage.getItem('blobl_user_data');
                if (cachedUser) {
                    const parsedUser = JSON.parse(cachedUser);
                    if (parsedUser && parsedUser.nickname) {
                        baseName = parsedUser.nickname;
                    }
                }
            } catch (e) {}
        }

        if (!baseName) {
            baseName = this.normalizePlayerName(this.DOM.menu.playerNameInput.value);
        }

        if (!baseName) {
            baseName = this.generateGuestNickname();
            if (this.DOM?.menu?.playerNameInput) {
                this.DOM.menu.playerNameInput.value = baseName;
                this.DOM.menu.playerNameInput.placeholder = baseName;
            }
        }

        const playerName = this.core?.networkManager?.applyOwnerTagToName?.(baseName) || this.normalizePlayerName(baseName);
        return playerName;
    }

    normalizePlayerName (rawName) {
        const input = String(rawName || "")
            .replace(/[\u0000-\u001F\u007F]/g, "")
            .trim();
        if (!input) return "";

        // Keep compatibility with the join protocol byte limit without stripping
        // spaces/special characters.
        const encoder = new TextEncoder();
        const chars = Array.from(input);
        while (chars.length > 0 && encoder.encode(chars.join("")).length > PLAYER_NAME_MAX_BYTES) {
            chars.pop();
        }
        return chars.join("");
    }

    generateGuestNickname () {
        const themedNames = [
            "Unknown", "UnknownX", "WarGhost", "HexShade", "VoidHex", "CipherX",
            "ShadowX", "DarkNode", "NullEcho", "RogueHex", "NightOps", "LostCore",
            "WardenX", "IronHex", "GhostNet", "PhantomX", "HexDrift", "WarpCore"
        ];
        const base = themedNames[Math.floor(Math.random() * themedNames.length)] || "Unknown";
        const suffix = Math.floor(Math.random() * 90) + 10; // 10-99
        return this.normalizePlayerName(`${base}${suffix}`);
    }

    showMenuContainer (show) {
        this.core.camera.enableControls(!show)
        this.DOM.menu.screen.style.display = show ? "flex" : "none";
    }

    showMenuSecondaryPanels (show) {
        const globalRank = document.getElementById("global-leaderboard");
        if (globalRank) {
            globalRank.style.display = show ? "flex" : "none";
        }
        if (show) {
            this._populateGlobalLeaderboard();
        }

        const legalLinks = document.getElementById("legal-links-corner");
        if (legalLinks) {
            legalLinks.style.display = show ? "flex" : "none";
        }
    }

    showGameOverContainer (show) {
        this.core.camera.enableControls(!show)
        this.DOM.game.over.container.style.display = show ? "flex" : "none";
    }

    showChat (show) {
        this.DOM.chat.container.style.display = show ? "flex" : "none";
        this.updateMusicControlsPosition();
    }

    showUnitControls (show) {
        if (this.DOM.game.unitControls.container) {
            this.DOM.game.unitControls.container.style.display = show ? "flex" : "none";
        }
    }

    showToolbar (show) {
        this.DOM.game.toolbar.style.display = show ? "flex" : "none";
    }

    showResource (show) {
        this.DOM.game.resources.container.style.display = show ? "flex" : "none";
        this.showSpawnProtectionTimer(false);
    }

    showLeaderboard (show) {
        this.DOM.game.leaderboard.style.display = show ? "flex" : "none";
    }

    showSkinLibraryDialog (show) {
        this.DOM.skins.libraryDialog.style.display = show ? "flex" : "none";
    }

    showConnectingOverlay (show) {
        if (show) {
            // Show overlay
            if (!this.loadingOverlay) {
                this.createConnectingOverlay();
            }
        } else {
            // Hide overlay
            this.removeConnectingOverlay();
        }
    }

    createConnectingOverlay () {
        if (this.loadingOverlay) return;

        this.loadingOverlay = document.createElement("div");
        this.loadingOverlay.classList.add("loading-overlay");

        const text = "Connecting...";
        for (let i = 0; i < text.length; i++) {
            const letterSpan = document.createElement("span");
            letterSpan.textContent = text[i];
            this.loadingOverlay.appendChild(letterSpan);
        }

        document.body.insertBefore(this.loadingOverlay, document.body.firstChild);

        const letters = this.loadingOverlay.querySelectorAll("span");
        letters.forEach((letter, index) => {
            letter.style.animationDelay = `${index * 0.1}s`;
            letter.classList.add("wave-animation");
        });
    }

    removeConnectingOverlay () {
        if (this.loadingOverlay && this.loadingOverlay.parentNode) {
            this.loadingOverlay.parentNode.removeChild(this.loadingOverlay);
            this.loadingOverlay = null;
        }
    }

    showMenuUIElements (show) {
        this.menuOpen = show;
        this.showMenuContainer(show);
        if (!show) {
            this.showMenuSecondaryPanels(false);
            return;
        }
        this.showMenuSecondaryPanels(!this.hideMenuSecondaryPanels);
    }

    showGameUIElements (show) {
        this.menuOpen = !show;
        if (show) {
            this.hideMenuSecondaryPanels = false;
            this.showMenuSecondaryPanels(false);
        } else {
            this.updateSoldierSelectionCounter(0, 0);
            this.hideDiscordJoinPrompt();
        }
        this.showLeaderboard(show);
        this.showToolbar(show && this.getHudPanelVisible("toolbar", true));
        this.showUnitControls(show && this.getHudPanelVisible("groupTroops", true));
        this.showResource(show);
        this.showChat(show);
        this.showMetrics(show);
        this.showMiniMap(show && this.getHudPanelVisible("miniMap", true));
        const autoBuildMenu = document.getElementById("autobuild-menu-container");
        if (autoBuildMenu) {
            autoBuildMenu.style.display = show ? "flex" : "none";
        }
        const musicControls = document.getElementById("music-controls-container");
        if (musicControls) {
            musicControls.style.display = show ? "flex" : "none";
        }
        if (show) {
            this.ensureHudCollapseControls();
            this.applyHudCollapsedStates();
            this.updateMusicControlsPosition();
            this.refreshMusicControls();
        }
        if (typeof this.core?.setGameplayActive === "function") {
            this.core.setGameplayActive(show);
        }
        if (show) {
            if (this.tutorialPendingStart) {
                this.tutorialPendingStart = false;
                this.openTutorial();
            }
        } else {
            this.closeTutorial({ silent: true });
            this.tutorialPendingStart = false;
        }
    }

    maybeShowOAuthError () {
        try {
            const rawError = String(localStorage.getItem("warhex_oauth_last_error") || "").trim();
            if (!rawError) return;
            localStorage.removeItem("warhex_oauth_last_error");
            alert(this.t("error.discordLoginFailed", { message: rawError }));
        } catch (e) {}
    }

    showDiscordJoinPrompt (inviteUrl = "https://discord.gg/Q337spAqR7") {
        this.hideDiscordJoinPrompt();

        const panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.top = "20px";
        panel.style.left = "50%";
        panel.style.transform = "translateX(-50%)";
        panel.style.width = "min(520px, calc(100vw - 24px))";
        panel.style.zIndex = "22000";
        panel.style.pointerEvents = "all";
        panel.style.background = "linear-gradient(145deg, rgba(12,18,40,0.96), rgba(20,32,66,0.96))";
        panel.style.border = "1px solid rgba(110, 200, 255, 0.72)";
        panel.style.borderRadius = "12px";
        panel.style.padding = "13px 14px";
        panel.style.boxShadow = "0 10px 28px rgba(0,0,0,0.42), 0 0 18px rgba(90,180,255,0.24)";
        panel.style.color = "#eaf6ff";
        panel.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "Welcome to Warhex.io";
        title.style.fontSize = "16px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "0.3px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = "Join our Discord community for updates, events, and support.";
        subtitle.style.marginTop = "5px";
        subtitle.style.fontSize = "13px";
        subtitle.style.fontWeight = "600";
        subtitle.style.color = "#ffffff";

        const link = document.createElement("div");
        link.textContent = inviteUrl;
        link.style.marginTop = "6px";
        link.style.fontSize = "12px";
        link.style.color = "#7be0ff";
        link.style.wordBreak = "break-all";

        const actions = document.createElement("div");
        actions.style.marginTop = "10px";
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";

        const laterButton = document.createElement("button");
        laterButton.type = "button";
        laterButton.textContent = "Later";
        laterButton.style.border = "1px solid rgba(190, 200, 230, 0.45)";
        laterButton.style.background = "rgba(24, 28, 50, 0.65)";
        laterButton.style.color = "#dbe9ff";
        laterButton.style.fontSize = "12px";
        laterButton.style.fontWeight = "700";
        laterButton.style.padding = "8px 12px";
        laterButton.style.borderRadius = "8px";
        laterButton.style.cursor = "pointer";

        const joinButton = document.createElement("button");
        joinButton.type = "button";
        joinButton.textContent = "Join Discord";
        joinButton.style.border = "1px solid rgba(120, 255, 165, 0.75)";
        joinButton.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
        joinButton.style.color = "#e8ffef";
        joinButton.style.fontSize = "12px";
        joinButton.style.fontWeight = "800";
        joinButton.style.padding = "8px 14px";
        joinButton.style.borderRadius = "8px";
        joinButton.style.cursor = "pointer";

        laterButton.addEventListener("click", () => this.hideDiscordJoinPrompt());
        joinButton.addEventListener("click", () => {
            if (typeof window !== "undefined" && typeof window.open === "function") {
                window.open(inviteUrl, "_blank", "noopener,noreferrer");
            }
            this.hideDiscordJoinPrompt();
        });

        actions.appendChild(laterButton);
        actions.appendChild(joinButton);
        panel.appendChild(title);
        panel.appendChild(subtitle);
        panel.appendChild(link);
        panel.appendChild(actions);

        document.body.appendChild(panel);
        this.discordJoinPromptElement = panel;
    }

    hideDiscordJoinPrompt () {
        if (this.discordJoinPromptElement && this.discordJoinPromptElement.parentNode) {
            this.discordJoinPromptElement.parentNode.removeChild(this.discordJoinPromptElement);
        }
        this.discordJoinPromptElement = null;
    }

    showGameOverUIElements (show) {
        this.hideUpgrades();
        this.showGameOverContainer(show);
    }

    showMenuDialog (title, message1, message2 = "", message3 = "", buttonText = "Okay", message4 = "") {
        const dialog = document.getElementById("menu-dialog");
        const dialogTitle = dialog.querySelector("h2");
        const dialogMessages = dialog.querySelectorAll("p");
        const dialogButton = document.getElementById("menu-dialog-button");

        if (dialog) {
            if (dialogTitle && typeof title === "string") {
                dialogTitle.textContent = title;
            }
            if (dialogMessages[0] && typeof message1 === "string") {
                dialogMessages[0].textContent = message1;
            }
            if (dialogMessages[1] && typeof message2 === "string") {
                dialogMessages[1].innerHTML = message2;
            }
            if (dialogMessages[2] && typeof message3 === "string") {
                dialogMessages[2].innerHTML = message3;
            }
            if (dialogMessages[3]) {
                const fallbackFourthLine = typeof this.t === "function"
                    ? this.t("menu.connectionTryAgain")
                    : "Try again in a bit!";
                dialogMessages[3].textContent = (typeof message4 === "string" && message4.trim() !== "")
                    ? message4
                    : fallbackFourthLine;
            }
            if (dialogButton && typeof buttonText === "string" && buttonText.trim() !== "") {
                dialogButton.textContent = buttonText;
            }
            dialog.style.display = "flex";
        }
        this.hideMenuSecondaryPanels = true;
        if (this.menuOpen) this.showMenuSecondaryPanels(false);
    }

    hideMenuDialog () {
        const dialog = document.getElementById("menu-dialog");
        if (dialog) {
            dialog.style.display = "none";
        }
        if (this.menuOpen) {
            this.showMenuSecondaryPanels(!this.hideMenuSecondaryPanels);
        }
    }

    updateResources () {
        const { power } = this.core.gameManager.resources;
        const effectiveRate = Number(power.generationRate || 0);
        const assistEnabled = Boolean(this.core?.unitManager?.commanderAssistEnabled);
        const hasCommander = Boolean(this.core?.gameManager?.hasCommander);
        const assistBuffPercent = 30;

        let gainLabel = `+${effectiveRate}/s`;
        if (assistEnabled && hasCommander && effectiveRate > 0) {
            const baseRate = this.estimateBaseGenerationRateFromBuff(effectiveRate, assistBuffPercent);
            if (baseRate !== null) {
                const buffRate = Math.max(0, effectiveRate - baseRate);
                gainLabel = `+${effectiveRate}/s <span style="opacity:.85">| buff +${assistBuffPercent}% (+${buffRate}/s)</span>`;
            } else {
                gainLabel = `+${effectiveRate}/s <span style="opacity:.85">| buff +${assistBuffPercent}%</span>`;
            }
        }

        this.DOM.game.resources.power.innerHTML = `Power: <span>${power.current}/${power.max} (${gainLabel})</span>`;


        this._updateCost(); // Update the upgrade panel
    }

    estimateBaseGenerationRateFromBuff (effectiveRate, buffPercent) {
        const safeEffective = Number(effectiveRate);
        const safeBuff = Number(buffPercent);
        if (!Number.isFinite(safeEffective) || safeEffective < 0) return null;
        if (!Number.isFinite(safeBuff) || safeBuff <= 0) return safeEffective;

        for (let base = 0; base <= safeEffective; base++) {
            const bonus = Math.floor((base * safeBuff + 99) / 100);
            if (base + bonus === safeEffective) {
                return base;
            }
        }

        // Fallback for edge cases where effective rate includes additional modifiers
        // and doesn't map exactly to base + ceil(base * buff%).
        const rawBase = Math.floor((safeEffective * 100) / (100 + safeBuff));
        return Math.max(0, Math.min(safeEffective, rawBase));
    }

    showSpawnProtectionTimer () {
        if (!this.DOM.game.resources.shield) return;
        this.DOM.game.resources.shield.style.display = "none";
    }

    showMetrics (show) {
        // Metrics (FPS/Bps) hidden by request.
        this.DOM.game.metrics.style.display = "none";
    }

    showGameSettingsButton (show) {
        // Settings are accessed from the top action menu; keep the legacy side slider hidden.
        this.DOM.settings.button.style.display = "none";
    }

    isGameplayInputBlocked () {
        const settingsPanel = this.DOM?.settings?.panel;
        const baseLayoutDialogOpen = Boolean(this.baseLayoutDialogElement && this.baseLayoutDialogElement.parentNode);
        if (!settingsPanel) {
            return Boolean(this.menuOpen || baseLayoutDialogOpen);
        }

        const inlineDisplay = settingsPanel.style?.display;
        const computedDisplay = typeof window !== "undefined" && window.getComputedStyle
            ? window.getComputedStyle(settingsPanel).display
            : "none";
        const settingsOpen = inlineDisplay === "flex" || computedDisplay !== "none";

        return Boolean(this.menuOpen || settingsOpen || baseLayoutDialogOpen);
    }

    showGameSettingsPanel (show) {
        this.DOM.settings.panel.style.display = show ? "flex" : "none";
    }

    showMiniMap (show) {
        this.DOM.game.miniMap.style.display = show ? "flex" : "none";
    }

    showLoginDialog (show) {
        const dialog = this.DOM.account.loginDialog || document.getElementById("login-dialog");
        if (dialog) {
            dialog.style.display = show ? "flex" : "none";
        }
    }

    formatTime (timestamp) {
        if (!timestamp) return "0s";
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    updateGameOverStats (killerName, score) {
        const { time } = this.core.gameManager.stats;
        document.getElementById("game-over-killed-by").textContent = killerName;
        document.getElementById("game-over-time-survived").textContent = this.formatTime(time);
        document.getElementById("game-over-score").textContent = score || 0;
    }

    gameOver (killer, score) {
        this.hideInactivityWarning();
        this.core.camera.setPosition(killer.position, true);
        this.core.camera.setZoom(0.75);

        this.updateGameOverStats(killer.name, score);

        this.showGameUIElements(false);
        this.showGameOverUIElements(true);
    }

    kicked (reason, score) {
        this.hideInactivityWarning();
        this.core.camera.setZoom(0.75);

        let killedBy = reason;
        if (reason === "Scripting") {
            killedBy = "your pathetic code.";
        }

        this.updateGameOverStats(killedBy, score);

        this.showGameUIElements(false);
        this.showGameOverUIElements(true);
    }

    makeChatBoxDraggable () {
        const chatElement = document.getElementById("chat");
        const moveButton = document.getElementById("chat-move-button");

        if (!chatElement || !moveButton) return;

        let startX, startY, initialX, initialY;

        const handleMouseDown = (e) => {
            if (!this.isDraggingChat) return;

            startX = e.clientX;
            startY = e.clientY;
            initialX = chatElement.offsetLeft;
            initialY = chatElement.offsetTop;

            chatElement.classList.add("dragging");

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        };

        const handleMouseMove = (e) => {
            if (!this.isDraggingChat) return;

            const currentX = e.clientX;
            const currentY = e.clientY;

            const deltaX = currentX - startX;
            const deltaY = currentY - startY;

            chatElement.style.left = `${initialX + deltaX}px`;
            chatElement.style.top = `${initialY + deltaY}px`;
        };

        const handleMouseUp = () => {
            if (this.isDraggingChat) {
                this.isDraggingChat = false;
                chatElement.classList.remove("dragging");

                document.removeEventListener("mousemove", handleMouseMove);
                document.removeEventListener("mouseup", handleMouseUp);
            }
        };

        const handleMouseDownOnMoveButton = (e) => {
            this.isDraggingChat = true; // Enable dragging
            moveButton.classList.add("active");
            handleMouseDown(e); // Start dragging
        };

        const handleMouseUpOnMoveButton = () => {
            if (this.isDraggingChat) {
                this.isDraggingChat = false;
                moveButton.classList.remove("active");
            }
        };

        moveButton.addEventListener("mousedown", handleMouseDownOnMoveButton);
        document.addEventListener("mouseup", handleMouseUpOnMoveButton);

        // Prevent dragging when clicking outside the move button
        chatElement.addEventListener("mousedown", (e) => {
            if (!this.isDraggingChat) return;
            e.preventDefault();
            handleMouseDown(e);
        });
    }

    setServerRebootAlert (minutes) {
        // Calculate the end time based on the current time and the specified minutes
        const endTime = Date.now() + minutes * 60 * 1000;

        // Function to update the alert text content
        const updateAlertText = (alertElement) => {
            const updateText = () => {
                const timeLeftMs = Math.max(0, endTime - Date.now()); // Time in milliseconds
                const timeLeftSec = Math.ceil(timeLeftMs / 1000); // Time in seconds

                const minutesLeft = Math.floor(timeLeftSec / 60); // Minutes left
                const secondsLeft = timeLeftSec % 60; // Seconds left

                // Create the message based on the time left
                let message;
                if (minutesLeft > 0) {
                    message = `Grab a snack, server's rebooting in ${minutesLeft}m ${secondsLeft}s!`;
                } else {
                    message = `Server's about to reboot in ${secondsLeft}s!`;
                }

                alertElement.textContent = message;

                if (timeLeftMs <= 0) {
                    clearInterval(alertElement.intervalId);
                    if (alertElement.parentNode) {
                        alertElement.parentNode.removeChild(alertElement);
                    }
                }
            };

            // Update the alert text immediately
            updateText();

            // Set an interval to update the text every second
            alertElement.intervalId = setInterval(updateText, 1000); // Every second
        };

        // Check if there""s already an alert
        let existingAlert = document.querySelector(".info-alert");

        if (existingAlert) {
            // Clear existing interval if any
            if (existingAlert.intervalId) {
                clearInterval(existingAlert.intervalId);
            }

            // Update the existing alert text content
            updateAlertText(existingAlert);
        } else {
            // Create the new alert element
            existingAlert = document.createElement("div");
            existingAlert.className = "info-alert";

            // Insert the alert element as the first child of the gameContainer
            const gameContainer = this.DOM.game.container;
            if (gameContainer) {
                if (gameContainer.firstChild) {
                    gameContainer.insertBefore(existingAlert, gameContainer.firstChild);
                } else {
                    gameContainer.appendChild(existingAlert);
                }

                // Set the initial text content
                updateAlertText(existingAlert);
            } else {
                console.error("Game container element is not found.");
            }
        }
    }

    updateMetrics () {
        if (!this.DOM.game.metrics) return;
        const { fps, bandwidthReceived } = this.core.gameManager.metrics;
        this.DOM.game.metrics.innerText = `${fps} FPS | ${bandwidthReceived}`
    }

    showPlayerSuggestions(query) {
        if (!this.DOM.chat.suggestions) return;

        const players = this.core.gameManager.players;
        const filteredPlayers = players.filter(p => p && p.name.toLowerCase().includes(query.toLowerCase()));

        this.DOM.chat.suggestions.innerHTML = "";
        this.DOM.chat.suggestions.style.display = "block";

        filteredPlayers.forEach(player => {
            const suggestionElement = document.createElement("div");
            suggestionElement.classList.add("chat-suggestion-item");
            suggestionElement.textContent = player.name;
            suggestionElement.addEventListener("mousedown", (e) => {
                e.preventDefault(); // Prevent input from losing focus
                const atIndex = this.DOM.chat.input.value.lastIndexOf('@');
                this.DOM.chat.input.value = this.DOM.chat.input.value.substring(0, atIndex + 1) + player.name + " ";
                this.hidePlayerSuggestions();
                this.DOM.chat.input.focus();
            });
            this.DOM.chat.suggestions.appendChild(suggestionElement);
        });

        if (filteredPlayers.length === 0) {
            this.hidePlayerSuggestions();
        }
    }

    hidePlayerSuggestions() {
        if (!this.DOM.chat.suggestions) return;
        this.DOM.chat.suggestions.style.display = "none";
        this.DOM.chat.suggestions.innerHTML = "";
    }

    showX1ChallengePrompt(challengerName, onAccept, onDecline) {
        this.hideX1SendPrompt();
        this.hideX1ChallengePrompt();

        const panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.top = "18px";
        panel.style.left = "50%";
        panel.style.transform = "translateX(-50%)";
        panel.style.width = "min(460px, calc(100vw - 20px))";
        panel.style.zIndex = "21000";
        panel.style.pointerEvents = "all";
        panel.style.background = "linear-gradient(145deg, rgba(10,20,44,0.96), rgba(20,38,78,0.96))";
        panel.style.border = "1px solid rgba(110, 200, 255, 0.7)";
        panel.style.borderRadius = "12px";
        panel.style.padding = "12px 14px";
        panel.style.boxShadow = "0 10px 28px rgba(0,0,0,0.42), 0 0 18px rgba(90,180,255,0.24)";
        panel.style.color = "#eaf6ff";
        panel.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "X1 challenge received";
        title.style.fontSize = "15px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "0.3px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = `${challengerName} challenged you to a protected X1.`;
        subtitle.style.marginTop = "4px";
        subtitle.style.fontSize = "13px";
        subtitle.style.fontWeight = "600";
        subtitle.style.color = "#ffffff";

        const actions = document.createElement("div");
        actions.style.marginTop = "10px";
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";

        const declineButton = document.createElement("button");
        declineButton.type = "button";
        declineButton.textContent = "Decline";
        declineButton.style.border = "1px solid rgba(255, 120, 120, 0.65)";
        declineButton.style.background = "rgba(150, 30, 30, 0.28)";
        declineButton.style.color = "#ffd6d6";
        declineButton.style.fontSize = "12px";
        declineButton.style.fontWeight = "700";
        declineButton.style.padding = "8px 12px";
        declineButton.style.borderRadius = "8px";
        declineButton.style.cursor = "pointer";

        const acceptButton = document.createElement("button");
        acceptButton.type = "button";
        acceptButton.textContent = "Accept";
        acceptButton.style.border = "1px solid rgba(120, 255, 165, 0.75)";
        acceptButton.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
        acceptButton.style.color = "#e8ffef";
        acceptButton.style.fontSize = "12px";
        acceptButton.style.fontWeight = "800";
        acceptButton.style.padding = "8px 14px";
        acceptButton.style.borderRadius = "8px";
        acceptButton.style.cursor = "pointer";

        declineButton.addEventListener("click", () => {
            this.hideX1ChallengePrompt();
            if (typeof onDecline === "function") onDecline();
        });

        acceptButton.addEventListener("click", () => {
            this.hideX1ChallengePrompt();
            if (typeof onAccept === "function") onAccept();
        });

        actions.appendChild(declineButton);
        actions.appendChild(acceptButton);
        panel.appendChild(title);
        panel.appendChild(subtitle);
        panel.appendChild(actions);

        document.body.appendChild(panel);
        this.x1PromptElement = panel;
        if (this.x1PromptTimeout) clearTimeout(this.x1PromptTimeout);
        this.x1PromptTimeout = setTimeout(() => {
            if (this.x1PromptElement) {
                this.hideX1ChallengePrompt();
                if (typeof onDecline === "function") onDecline();
            }
        }, 10000);
    }

    hideX1ChallengePrompt() {
        if (this.x1PromptTimeout) {
            clearTimeout(this.x1PromptTimeout);
            this.x1PromptTimeout = null;
        }
        if (this.x1PromptElement && this.x1PromptElement.parentNode) {
            this.x1PromptElement.parentNode.removeChild(this.x1PromptElement);
        }
        this.x1PromptElement = null;
    }

    showX1SendPrompt(targetName, onConfirm, onCancel) {
        this.hideX1ChallengePrompt();
        this.hideX1SendPrompt();
        this.hideEnemyCoreActions();

        const panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.top = "8px";
        panel.style.left = "8px";
        panel.style.transform = "none";
        panel.style.width = "min(300px, calc(100vw - 18px))";
        panel.style.zIndex = "20999";
        panel.style.pointerEvents = "all";
        panel.style.background = "linear-gradient(145deg, rgba(10,20,44,0.96), rgba(20,38,78,0.96))";
        panel.style.border = "1px solid rgba(102, 225, 255, 0.65)";
        panel.style.borderRadius = "12px";
        panel.style.padding = "12px 14px";
        panel.style.boxShadow = "0 10px 24px rgba(0,0,0,0.42), 0 0 16px rgba(96,193,255,0.21)";
        panel.style.color = "#eaf6ff";
        panel.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "Challenge X1";
        title.style.fontSize = "14px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "0.3px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = `Send protected X1 challenge to ${targetName}?`;
        subtitle.style.marginTop = "4px";
        subtitle.style.fontSize = "13px";
        subtitle.style.fontWeight = "600";
        subtitle.style.color = "#ffffff";

        const actions = document.createElement("div");
        actions.style.marginTop = "10px";
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Cancel";
        cancelButton.style.border = "1px solid rgba(255, 130, 130, 0.65)";
        cancelButton.style.background = "rgba(120, 36, 36, 0.25)";
        cancelButton.style.color = "#ffd6d6";
        cancelButton.style.fontSize = "12px";
        cancelButton.style.fontWeight = "700";
        cancelButton.style.padding = "8px 12px";
        cancelButton.style.borderRadius = "8px";
        cancelButton.style.cursor = "pointer";

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.textContent = "Send";
        confirmButton.style.border = "1px solid rgba(120, 255, 165, 0.75)";
        confirmButton.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
        confirmButton.style.color = "#e8ffef";
        confirmButton.style.fontSize = "12px";
        confirmButton.style.fontWeight = "800";
        confirmButton.style.padding = "8px 14px";
        confirmButton.style.borderRadius = "8px";
        confirmButton.style.cursor = "pointer";

        cancelButton.addEventListener("click", () => {
            this.hideX1SendPrompt();
            if (typeof onCancel === "function") onCancel();
        });

        confirmButton.addEventListener("click", () => {
            this.hideX1SendPrompt();
            if (typeof onConfirm === "function") onConfirm();
        });

        actions.appendChild(cancelButton);
        actions.appendChild(confirmButton);
        panel.appendChild(title);
        panel.appendChild(subtitle);
        panel.appendChild(actions);

        document.body.appendChild(panel);
        this.x1SendPromptElement = panel;
        if (this.x1SendPromptTimeout) clearTimeout(this.x1SendPromptTimeout);
        this.x1SendPromptTimeout = setTimeout(() => {
            if (this.x1SendPromptElement) {
                this.hideX1SendPrompt();
                if (typeof onCancel === "function") onCancel();
            }
        }, 7000);
    }

    hideX1SendPrompt() {
        if (this.x1SendPromptTimeout) {
            clearTimeout(this.x1SendPromptTimeout);
            this.x1SendPromptTimeout = null;
        }
        if (this.x1SendPromptElement && this.x1SendPromptElement.parentNode) {
            this.x1SendPromptElement.parentNode.removeChild(this.x1SendPromptElement);
        }
        this.x1SendPromptElement = null;
    }

    showEnemyCoreActions(targetName, onChallengeX1, onNotifyLeaveBase, onCancel) {
        this.hideX1ChallengePrompt();
        this.hideX1SendPrompt();
        this.hideEnemyCoreActions();

        const panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.top = "8px";
        panel.style.left = "8px";
        panel.style.transform = "none";
        panel.style.zIndex = "20998";
        panel.style.width = "min(300px, calc(100vw - 18px))";
        panel.style.pointerEvents = "all";
        panel.style.background = "linear-gradient(180deg, rgba(22,8,46,0.96), rgba(12,6,28,0.96))";
        panel.style.border = "1px solid rgba(183, 123, 255, 0.48)";
        panel.style.borderRadius = "10px";
        panel.style.padding = "8px";
        panel.style.boxShadow = "0 8px 20px rgba(0,0,0,0.36), 0 0 14px rgba(174, 96, 255, 0.2)";
        panel.style.color = "#efe6ff";
        panel.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const header = document.createElement("div");
        header.style.display = "flex";
        header.style.alignItems = "center";
        header.style.justifyContent = "space-between";

        const title = document.createElement("div");
        title.textContent = "Enemy Base";
        title.style.fontSize = "15px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "0.2px";
        title.style.color = "#efe6ff";

        const closeTopButton = document.createElement("button");
        closeTopButton.type = "button";
        closeTopButton.textContent = "x";
        closeTopButton.style.width = "16px";
        closeTopButton.style.height = "16px";
        closeTopButton.style.display = "inline-flex";
        closeTopButton.style.alignItems = "center";
        closeTopButton.style.justifyContent = "center";
        closeTopButton.style.border = "1px solid rgba(206, 141, 255, 0.48)";
        closeTopButton.style.background = "rgba(57, 24, 86, 0.8)";
        closeTopButton.style.color = "#f3e9ff";
        closeTopButton.style.fontSize = "10px";
        closeTopButton.style.fontWeight = "800";
        closeTopButton.style.borderRadius = "5px";
        closeTopButton.style.cursor = "pointer";
        closeTopButton.style.lineHeight = "1";
        closeTopButton.addEventListener("click", () => {
            this.hideEnemyCoreActions();
            if (typeof onCancel === "function") onCancel();
        });
        header.appendChild(title);
        header.appendChild(closeTopButton);

        const subtitle = document.createElement("div");
        subtitle.textContent = targetName || "Player";
        subtitle.style.marginTop = "4px";
        subtitle.style.fontSize = "12px";
        subtitle.style.fontWeight = "700";
        subtitle.style.color = "#d9c6ff";

        const actions = document.createElement("div");
        actions.style.marginTop = "8px";
        actions.style.display = "grid";
        actions.style.gap = "8px";

        const createActionButton = (label, description, clickHandler) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.style.width = "100%";
            btn.style.textAlign = "left";
            btn.style.border = "1px solid rgba(177, 126, 255, 0.45)";
            btn.style.background = "rgba(37, 14, 66, 0.72)";
            btn.style.color = "#f3ebff";
            btn.style.borderRadius = "8px";
            btn.style.padding = "9px 10px";
            btn.style.cursor = "pointer";
            btn.style.display = "block";
            btn.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";
            btn.style.transition = "filter 120ms ease, border-color 120ms ease";

            const t = document.createElement("div");
            t.textContent = label;
            t.style.fontSize = "12px";
            t.style.fontWeight = "800";

            const d = document.createElement("div");
            d.textContent = description;
            d.style.marginTop = "2px";
            d.style.fontSize = "11px";
            d.style.opacity = "0.9";

            btn.addEventListener("mouseenter", () => {
                btn.style.filter = "brightness(1.07)";
                btn.style.borderColor = "rgba(205, 156, 255, 0.82)";
            });
            btn.addEventListener("mouseleave", () => {
                btn.style.filter = "brightness(1)";
                btn.style.borderColor = "rgba(177, 126, 255, 0.45)";
            });

            btn.appendChild(t);
            btn.appendChild(d);
            btn.addEventListener("click", () => {
                this.hideEnemyCoreActions();
                if (typeof clickHandler === "function") clickHandler();
            });
            return btn;
        };

        if (typeof onChallengeX1 === "function") {
            actions.appendChild(createActionButton(
                "Challenge to X1",
                "Send a protected X1 challenge to this player.",
                onChallengeX1
            ));
        }
        if (typeof onNotifyLeaveBase === "function") {
            actions.appendChild(createActionButton(
                "Notify When They Leave Base",
                "Get a chat alert when this player loses spawn protection.",
                onNotifyLeaveBase
            ));
        }

        if (actions.children.length === 0) {
            const empty = document.createElement("div");
            empty.textContent = "No actions available right now.";
            empty.style.fontSize = "13px";
            empty.style.opacity = "0.9";
            actions.appendChild(empty);
        }

        const cancelRow = document.createElement("div");
        cancelRow.style.marginTop = "8px";
        cancelRow.style.display = "flex";
        cancelRow.style.justifyContent = "flex-end";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Close";
        cancelButton.style.border = "1px solid rgba(206, 141, 255, 0.48)";
        cancelButton.style.background = "rgba(57, 24, 86, 0.8)";
        cancelButton.style.color = "#f3e9ff";
        cancelButton.style.fontSize = "12px";
        cancelButton.style.fontWeight = "700";
        cancelButton.style.padding = "6px 10px";
        cancelButton.style.borderRadius = "7px";
        cancelButton.style.cursor = "pointer";
        cancelButton.addEventListener("click", () => {
            this.hideEnemyCoreActions();
            if (typeof onCancel === "function") onCancel();
        });
        cancelRow.appendChild(cancelButton);

        panel.appendChild(header);
        panel.appendChild(subtitle);
        panel.appendChild(actions);
        panel.appendChild(cancelRow);

        document.body.appendChild(panel);
        this.enemyCoreActionsElement = panel;
    }

    hideEnemyCoreActions() {
        if (this.enemyCoreActionsElement && this.enemyCoreActionsElement.parentNode) {
            this.enemyCoreActionsElement.parentNode.removeChild(this.enemyCoreActionsElement);
        }
        this.enemyCoreActionsElement = null;
    }

    getBaseLayoutStorageKey () {
        return "saved_base_layouts_v1";
    }

    getSavedBaseLayouts () {
        try {
            const raw = localStorage.getItem(this.getBaseLayoutStorageKey());
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error("Could not parse saved base layouts:", error);
            return [];
        }
    }

    setSavedBaseLayouts (layouts) {
        try {
            localStorage.setItem(this.getBaseLayoutStorageKey(), JSON.stringify(layouts));
        } catch (error) {
            console.error("Could not store saved base layouts:", error);
        }
    }

    getPublicBaseHotkeyStorageKey () {
        return "saved_public_base_layout_hotkeys_v1";
    }

    getPublicBaseHotkeyMetaStorageKey () {
        return "saved_public_base_layout_hotkeys_meta_v1";
    }

    getSavedPublicBaseHotkeys () {
        try {
            const raw = localStorage.getItem(this.getPublicBaseHotkeyStorageKey());
            const parsed = raw ? JSON.parse(raw) : {};
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
            const out = {};
            Object.keys(parsed).forEach((layoutKey) => {
                const normalized = this.normalizeKeybindValue(parsed[layoutKey]);
                if (normalized) out[String(layoutKey)] = normalized;
            });
            return out;
        } catch (error) {
            console.error("Could not parse public base layout hotkeys:", error);
            return {};
        }
    }

    setSavedPublicBaseHotkeys (map) {
        try {
            localStorage.setItem(this.getPublicBaseHotkeyStorageKey(), JSON.stringify(map || {}));
        } catch (error) {
            console.error("Could not store public base layout hotkeys:", error);
        }
    }

    getSavedPublicBaseHotkeyMeta () {
        try {
            const raw = localStorage.getItem(this.getPublicBaseHotkeyMetaStorageKey());
            const parsed = raw ? JSON.parse(raw) : {};
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
            return parsed;
        } catch (error) {
            console.error("Could not parse public base layout hotkey metadata:", error);
            return {};
        }
    }

    setSavedPublicBaseHotkeyMeta (map) {
        try {
            localStorage.setItem(this.getPublicBaseHotkeyMetaStorageKey(), JSON.stringify(map || {}));
        } catch (error) {
            console.error("Could not store public base layout hotkey metadata:", error);
        }
    }

    getBaseLayoutEntryKey (layout) {
        const rawId = layout?.id;
        if (rawId !== null && rawId !== undefined && String(rawId).trim() !== "") {
            return `id:${String(rawId)}`;
        }
        return `meta:${String(layout?.name || "")}:${String(layout?.createdAt || layout?.created_at || "")}`;
    }

    normalizeBaseLayoutBuildings (value) {
        if (Array.isArray(value)) {
            return value.filter((entry) => entry && typeof entry === "object");
        }
        if (value && typeof value === "object") {
            return Object.values(value).filter((entry) => entry && typeof entry === "object");
        }
        return [];
    }

    normalizeBaseLayoutForLoading (layout) {
        const normalizedLayout = (layout && typeof layout === "object") ? layout : {};
        const buildings = this.normalizeBaseLayoutBuildings(normalizedLayout.buildings).length > 0
            ? this.normalizeBaseLayoutBuildings(normalizedLayout.buildings)
            : this.normalizeBaseLayoutBuildings(normalizedLayout?.layout_json?.buildings);

        return {
            ...normalizedLayout,
            name: normalizedLayout.name || "Unnamed Base",
            createdAt: normalizedLayout.createdAt || normalizedLayout.created_at || null,
            authorName: normalizedLayout.authorName || normalizedLayout.author_name || "",
            hotkey: this.normalizeKeybindValue(normalizedLayout.hotkey || ""),
            snapshot: this.normalizeBaseLayoutSnapshot(normalizedLayout.snapshot),
            buildings
        };
    }

    getConfiguredKeyUsageEntries () {
        const entries = [];
        const push = (scope, id, keyValue, label) => {
            const key = this.normalizeKeybindValue(keyValue);
            if (!key) return;
            entries.push({ scope, id, key, label: String(label || id || scope) });
        };

        const hudKeybinds = this.hudConfig?.keybinds || {};
        Object.keys(hudKeybinds).forEach((actionKey) => {
            push("hud", actionKey, hudKeybinds[actionKey], this.getHudKeybindLabel(actionKey));
        });

        const upgradeHotkeys = (this.hudConfig?.upgradeHotkeys && typeof this.hudConfig.upgradeHotkeys === "object")
            ? this.hudConfig.upgradeHotkeys
            : {};
        const validUpgradeIds = new Set(this.getUpgradeHotkeyDefinitions().map((entry) => String(entry?.id || "")));
        Object.keys(upgradeHotkeys).forEach((upgradeId) => {
            if (!validUpgradeIds.has(String(upgradeId || ""))) return;
            push("upgrade-item", upgradeId, upgradeHotkeys[upgradeId], this.getUpgradeHotkeyLabel(upgradeId));
        });

        this.getSavedBaseLayouts().forEach((layout) => {
            const normalizedLayout = this.normalizeBaseLayoutForLoading(layout);
            const id = this.getBaseLayoutEntryKey(normalizedLayout);
            const name = normalizedLayout?.name || "Unnamed Base";
            push("base-local", id, normalizedLayout.hotkey, `Local Base: ${name}`);
        });

        const publicMap = this.getSavedPublicBaseHotkeys();
        const publicMeta = this.getSavedPublicBaseHotkeyMeta();
        Object.keys(publicMap).forEach((layoutKey) => {
            const idText = String(layoutKey || "");
            const fallbackLabel = idText.startsWith("id:")
                ? `Public Base #${idText.slice(3)}`
                : "Public Base";
            const metaName = String(publicMeta?.[layoutKey]?.name || "").trim();
            push("base-public", layoutKey, publicMap[layoutKey], metaName ? `Public Base: ${metaName}` : fallbackLabel);
        });

        const buildingManager = this.core?.buildingManager;
        push("defense", "placement", buildingManager?.defensePlacementKey, "Defense Placement");
        push("defense", "remount", buildingManager?.defenseRemountKey, "Defense Remount");

        return entries;
    }

    findConfiguredKeyConflict (keyValue, options = {}) {
        const normalized = this.normalizeKeybindValue(keyValue);
        if (!normalized) return null;
        const excluded = new Set();
        const excludeScope = options?.excludeScope ? String(options.excludeScope) : "";
        const excludeId = options?.excludeId ? String(options.excludeId) : "";
        if (excludeScope && excludeId) excluded.add(`${excludeScope}:${excludeId}`);
        (Array.isArray(options?.excludeEntries) ? options.excludeEntries : []).forEach((entry) => {
            if (!entry || typeof entry !== "object") return;
            const scope = String(entry.scope || "");
            const id = String(entry.id || "");
            if (scope && id) excluded.add(`${scope}:${id}`);
        });

        const entries = this.getConfiguredKeyUsageEntries();
        for (let i = 0; i < entries.length; i += 1) {
            const entry = entries[i];
            if (entry.key !== normalized) continue;
            const token = `${entry.scope}:${entry.id}`;
            if (excluded.has(token)) continue;
            return entry;
        }
        return null;
    }

    showKeyConflictNotice (keyValue, conflictEntry = null, options = {}) {
        const keyLabel = this.formatKeybindLabel(keyValue || "");
        const targetLabel = String(conflictEntry?.label || "another action").trim();
        if (options?.assigned) {
            this.notifySystemWarning(`Key ${keyLabel} is already used by "${targetLabel}". Assigned anyway.`);
            return;
        }
        this.notifySystemWarning(`Key ${keyLabel} is already used by "${targetLabel}". Choose another key.`);
    }

    triggerBaseLayoutHotkeyLoad (keyValue) {
        const key = this.normalizeKeybindValue(keyValue);
        if (!key) return false;
        if (this.isReservedGameplayKeybind(key)) return false;
        if (!this.core?.gameManager?.player) return false;
        if (this.isChatInputFocused) return false;
        if (this.baseLayoutDialogElement && this.baseLayoutDialogElement.parentNode) return false;
        if (this._baseLayoutHotkeyLoadInFlight) return true;

        const localLayouts = this.getSavedBaseLayouts()
            .map((layout) => this.normalizeBaseLayoutForLoading(layout))
            .filter((layout) => this.normalizeKeybindValue(layout.hotkey || "") === key);

        const publicMap = this.getSavedPublicBaseHotkeys();
        const publicMeta = this.getSavedPublicBaseHotkeyMeta();
        const publicMatches = Object.keys(publicMap)
            .filter((layoutKey) => this.normalizeKeybindValue(publicMap[layoutKey]) === key);

        if (localLayouts.length === 0 && publicMatches.length === 0) return false;

        if (localLayouts.length > 0 && publicMatches.length > 0) {
            this.notifySystemWarning(`Key ${this.formatKeybindLabel(key)} is assigned to both Local and Public base. Pick a unique key.`);
            return true;
        }

        if (localLayouts.length > 0) {
            const targetLayout = localLayouts[0];
            if (!Array.isArray(targetLayout.buildings) || targetLayout.buildings.length === 0) {
                this.notifySystemWarning("This local base has no buildings to load.");
                return true;
            }
            this.showScreenNotice(`Loading base "${targetLayout.name || "Base"}"...`, {
                textColor: "#e8ffef",
                borderColor: "rgba(120, 255, 165, 0.74)"
            });
            this.core.buildingManager.loadBaseLayout(targetLayout);
            return true;
        }

        const targetPublicKey = publicMatches[0];
        const match = /^id:(.+)$/.exec(String(targetPublicKey || ""));
        const publicId = match && match[1] ? match[1] : "";
        if (!publicId) {
            this.notifySystemWarning("Public base hotkey is outdated. Open Load Base and set the key again.");
            return true;
        }

        this._baseLayoutHotkeyLoadInFlight = true;
        this.showScreenNotice("Loading public base...", {
            textColor: "#e8ffef",
            borderColor: "rgba(120, 205, 255, 0.74)"
        });

        fetchPublicBaseLayoutByIdSafe(publicId).then((result) => {
            if (!result?.success || !result?.data) {
                this.notifySystemWarning("Could not load this public base.");
                return;
            }
            const details = result.data;
            const normalized = this.normalizeBaseLayoutForLoading({
                ...details,
                id: details?.id ?? publicId,
                name: details?.name || publicMeta?.[targetPublicKey]?.name || `Public Base #${publicId}`
            });
            if (!Array.isArray(normalized.buildings) || normalized.buildings.length === 0) {
                this.notifySystemWarning("This public base has no buildings to load.");
                return;
            }
            this.core.buildingManager.loadBaseLayout(normalized);
        }).catch(() => {
            this.notifySystemWarning("Could not load this public base.");
        }).finally(() => {
            this._baseLayoutHotkeyLoadInFlight = false;
        });

        return true;
    }

    getCurrentBaseCaptureBounds (player) {
        const buildings = (player?.buildings || []).filter(b => b && !b.removeFlag);

        let minX = player?.position?.x || 0;
        let maxX = player?.position?.x || 0;
        let minY = player?.position?.y || 0;
        let maxY = player?.position?.y || 0;

        // Estimate a safe capture bounds around all current base buildings.
        for (const building of buildings) {
            const details = getBuildingDetails(building.type, building.variant ?? 0);
            const half = (details?.size || 30) + 10;
            minX = Math.min(minX, building.position.x - half);
            maxX = Math.max(maxX, building.position.x + half);
            minY = Math.min(minY, building.position.y - half);
            maxY = Math.max(maxY, building.position.y + half);
        }

        // Include base rings (defense/protection circles) so snapshots don't cut them off.
        const baseRingRadius = Math.max(
            player?.buildingRadius?.max || 0,
            player?.spawnProtectionRadius || 0
        );
        if (baseRingRadius > 0) {
            minX = Math.min(minX, player.position.x - baseRingRadius);
            maxX = Math.max(maxX, player.position.x + baseRingRadius);
            minY = Math.min(minY, player.position.y - baseRingRadius);
            maxY = Math.max(maxY, player.position.y + baseRingRadius);
        }

        // Include the core and some visual breathing room.
        const extraMarginWorld = 90;
        minX -= extraMarginWorld;
        maxX += extraMarginWorld;
        minY -= extraMarginWorld;
        maxY += extraMarginWorld;

        return { minX, maxX, minY, maxY };
    }

    normalizeBaseLayoutSnapshot (snapshot) {
        if (typeof snapshot !== "string") return null;
        const value = snapshot.trim();
        if (!value) return null;
        if (
            value.startsWith("data:image/")
            || value.startsWith("http://")
            || value.startsWith("https://")
            || value.startsWith("blob:")
        ) {
            return value;
        }

        const compact = value.replace(/\s+/g, "");
        const looksLikeBase64 = compact.length > 120 && /^[A-Za-z0-9+/=]+$/.test(compact);
        if (looksLikeBase64) {
            return `data:image/jpeg;base64,${compact}`;
        }
        return null;
    }

    captureCurrentBaseSnapshot (options = {}) {
        const forceCenter = Boolean(options?.forceCenter);
        const restoreViewAfterCapture = Boolean(options?.restoreViewAfterCapture);
        const canvas = this.core?.canvas;
        const player = this.core?.gameManager?.player;
        const camera = this.core?.camera;
        if (!canvas) return null;

        let previousCameraState = null;
        try {
            if (!player || !camera) {
                return canvas.toDataURL("image/jpeg", 0.75);
            }

            const bounds = this.getCurrentBaseCaptureBounds(player);

            if (forceCenter) {
                previousCameraState = {
                    x: camera.x,
                    y: camera.y,
                    zoom: camera.zoom,
                    targetZoom: camera.targetZoom,
                    targetPosition: {
                        x: camera?.targetPosition?.x,
                        y: camera?.targetPosition?.y
                    }
                };

                const worldWidth = Math.max(220, bounds.maxX - bounds.minX);
                const worldHeight = Math.max(220, bounds.maxY - bounds.minY);
                const desiredZoomUnclamped = Math.min(
                    (canvas.width * 0.8) / worldWidth,
                    (canvas.height * 0.8) / worldHeight
                );
                const minZoom = Number.isFinite(camera.minZoom) ? camera.minZoom : 0.02;
                const maxZoom = Number.isFinite(camera.maxZoom) ? camera.maxZoom : 50;
                const desiredZoom = Math.max(
                    minZoom,
                    Math.min(
                        maxZoom,
                        Number.isFinite(desiredZoomUnclamped) && desiredZoomUnclamped > 0
                            ? desiredZoomUnclamped
                            : (Number.isFinite(camera.zoom) ? camera.zoom : 0.75)
                    )
                );

                const currentX = Number.isFinite(camera.x) ? camera.x : 0;
                const currentY = Number.isFinite(camera.y) ? camera.y : 0;
                const playerX = Number.isFinite(player?.position?.x) ? player.position.x : currentX;
                const playerY = Number.isFinite(player?.position?.y) ? player.position.y : currentY;

                const beforeSetPosX = currentX;
                const beforeSetPosY = currentY;
                if (typeof camera.setPosition === "function") {
                    camera.setPosition(player.position, false);
                }

                let targetCamX = Number.isFinite(camera?.targetPosition?.x) ? camera.targetPosition.x : camera.x;
                let targetCamY = Number.isFinite(camera?.targetPosition?.y) ? camera.targetPosition.y : camera.y;
                const nativeCenteringWorked =
                    Number.isFinite(targetCamX) && Number.isFinite(targetCamY)
                    && (Math.abs(targetCamX - beforeSetPosX) > 0.0001 || Math.abs(targetCamY - beforeSetPosY) > 0.0001);

                if (!nativeCenteringWorked) {
                    targetCamX = Math.abs(playerX - currentX) <= Math.abs((playerX / 2) - currentX) ? playerX : (playerX / 2);
                    targetCamY = Math.abs(playerY - currentY) <= Math.abs((playerY / 2) - currentY) ? playerY : (playerY / 2);
                }

                camera.zoom = desiredZoom;
                camera.targetZoom = desiredZoom;
                camera.x = targetCamX;
                camera.y = targetCamY;
                if (camera.targetPosition) {
                    camera.targetPosition.x = targetCamX;
                    camera.targetPosition.y = targetCamY;
                }

                // Force one immediate render so the snapshot always matches the centered camera.
                if (typeof this.core?.renderer?.render === "function") {
                    this.core.renderer.render(16.67);
                }
            }

            const zoom = camera.zoom || 1;
            const { minX, maxX, minY, maxY } = bounds;

            const cameraWorldX = (Number.isFinite(camera.x) ? camera.x : 0) * 2;
            const cameraWorldY = (Number.isFinite(camera.y) ? camera.y : 0) * 2;
            const screenLeft = (minX - cameraWorldX) * zoom + canvas.width / 2;
            const screenRight = (maxX - cameraWorldX) * zoom + canvas.width / 2;
            const screenTop = (minY - cameraWorldY) * zoom + canvas.height / 2;
            const screenBottom = (maxY - cameraWorldY) * zoom + canvas.height / 2;

            const neededWidth = Math.max(180, Math.round(screenRight - screenLeft));
            const neededHeight = Math.max(180, Math.round(screenBottom - screenTop));
            const sourceSize = Math.max(neededWidth, neededHeight);

            const centerX = Math.round((screenLeft + screenRight) / 2);
            const centerY = Math.round((screenTop + screenBottom) / 2);
            const sx = Math.max(0, Math.min(canvas.width - sourceSize, Math.round(centerX - sourceSize / 2)));
            const sy = Math.max(0, Math.min(canvas.height - sourceSize, Math.round(centerY - sourceSize / 2)));
            const sw = Math.max(1, Math.min(canvas.width - sx, sourceSize));
            const sh = Math.max(1, Math.min(canvas.height - sy, sourceSize));

            // Fixed output size avoids "zoomed" previews and scales large bases down to fit.
            const outputSize = 640;

            const offscreen = document.createElement("canvas");
            offscreen.width = outputSize;
            offscreen.height = outputSize;
            const context = offscreen.getContext("2d");
            if (!context) {
                return canvas.toDataURL("image/jpeg", 0.75);
            }
            context.fillStyle = "#03060f";
            context.fillRect(0, 0, outputSize, outputSize);
            context.drawImage(canvas, sx, sy, sw, sh, 0, 0, outputSize, outputSize);
            return offscreen.toDataURL("image/jpeg", 0.8);
        } catch (error) {
            console.error("Could not capture base snapshot:", error);
            return null;
        } finally {
            if (forceCenter && restoreViewAfterCapture && previousCameraState && camera) {
                camera.x = previousCameraState.x;
                camera.y = previousCameraState.y;
                camera.zoom = previousCameraState.zoom;
                camera.targetZoom = previousCameraState.targetZoom;
                if (camera.targetPosition && previousCameraState.targetPosition) {
                    camera.targetPosition.x = previousCameraState.targetPosition.x;
                    camera.targetPosition.y = previousCameraState.targetPosition.y;
                }
                if (typeof this.core?.renderer?.render === "function") {
                    this.core.renderer.render(16.67);
                }
            }
        }
    }

    hideBaseLayoutDialog () {
        if (typeof this.baseLayoutDialogCleanup === "function") {
            try {
                this.baseLayoutDialogCleanup();
            } catch (error) {
                console.error("Could not cleanup base layout dialog listeners:", error);
            }
        }
        this.baseLayoutDialogCleanup = null;
        if (this.baseLayoutDialogElement && this.baseLayoutDialogElement.parentNode) {
            this.baseLayoutDialogElement.parentNode.removeChild(this.baseLayoutDialogElement);
        }
        this.baseLayoutDialogElement = null;
    }

    showSaveBaseLayoutDialog () {
        this.tutorialActionMarks.saveBaseAt = Date.now();
        this.hideBaseLayoutDialog();

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0, 0, 0, 0.5)";
        overlay.style.zIndex = "20020";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.pointerEvents = "all";

        const card = document.createElement("div");
        card.style.width = "min(560px, 94vw)";
        card.style.background = "linear-gradient(145deg, rgba(9,17,34,0.97), rgba(16,30,58,0.97))";
        card.style.border = "2px solid rgba(102, 225, 255, 0.65)";
        card.style.borderRadius = "14px";
        card.style.padding = "18px";
        card.style.color = "#eaf6ff";
        card.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "SAVE BASE";
        title.style.fontSize = "20px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "1px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = "Name your base. Save will auto center and capture preview.";
        subtitle.style.marginTop = "6px";
        subtitle.style.fontSize = "14px";
        subtitle.style.opacity = "0.92";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Layout name (e.g. Aggro Ring)";
        input.maxLength = 30;
        input.value = `Base ${new Date().toLocaleTimeString()}`;
        input.style.width = "100%";
        input.style.marginTop = "12px";
        input.style.height = "40px";
        input.style.borderRadius = "10px";
        input.style.border = "1px solid rgba(120, 180, 255, 0.55)";
        input.style.background = "rgba(8,18,40,0.65)";
        input.style.color = "#eaf6ff";
        input.style.padding = "0 12px";
        input.style.outline = "none";

        const publishRow = document.createElement("label");
        publishRow.style.display = "flex";
        publishRow.style.alignItems = "center";
        publishRow.style.gap = "8px";
        publishRow.style.marginTop = "10px";
        publishRow.style.fontSize = "13px";
        publishRow.style.opacity = "0.95";

        const publishCheckbox = document.createElement("input");
        publishCheckbox.type = "checkbox";
        publishCheckbox.checked = false;
        publishCheckbox.style.width = "16px";
        publishCheckbox.style.height = "16px";
        publishCheckbox.style.cursor = "pointer";

        const publishText = document.createElement("span");
        publishText.textContent = "Make this base public (other players can load it)";
        publishRow.appendChild(publishCheckbox);
        publishRow.appendChild(publishText);

        const actions = document.createElement("div");
        actions.style.marginTop = "14px";
        actions.style.display = "flex";
        actions.style.gap = "10px";
        actions.style.justifyContent = "flex-end";

        const cancel = document.createElement("button");
        cancel.textContent = "Cancel";
        cancel.style.border = "1px solid rgba(255, 130, 130, 0.65)";
        cancel.style.background = "rgba(120, 36, 36, 0.25)";
        cancel.style.color = "#ffd6d6";
        cancel.style.padding = "10px 14px";
        cancel.style.borderRadius = "10px";
        cancel.style.cursor = "pointer";
        cancel.addEventListener("click", () => this.hideBaseLayoutDialog());

        const save = document.createElement("button");
        save.textContent = "Save";
        save.style.border = "1px solid rgba(120, 255, 165, 0.75)";
        save.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
        save.style.color = "#e8ffef";
        save.style.padding = "10px 16px";
        save.style.borderRadius = "10px";
        save.style.cursor = "pointer";
        save.style.fontWeight = "800";
        save.addEventListener("click", async () => {
            if (save.disabled) return;
            const wasPublishing = publishCheckbox.checked;
            const originalButtonText = save.textContent;
            save.disabled = true;
            save.textContent = wasPublishing ? "Saving + Publishing..." : "Saving...";
            const watchdogId = setTimeout(() => {
                save.disabled = false;
                save.textContent = originalButtonText;
            }, 12000);
            try {
                // Always center + capture on Save, as requested.
                const snapshot = this.captureCurrentBaseSnapshot({ forceCenter: true })
                    || this.captureCurrentBaseSnapshot({ forceCenter: false });

                const layout = this.core.buildingManager.exportCurrentBaseLayout(input.value, snapshot);
                if (!layout) {
                    this.addChatMessage("System", "Could not save base right now.", "#ffcc66");
                    save.disabled = false;
                    save.textContent = originalButtonText;
                    return;
                }
                const existing = this.getSavedBaseLayouts().slice(0, 29);
                this.setSavedBaseLayouts([layout, ...existing]);
                this.addChatMessage("System", `Base "${layout.name}" saved.`, "#60c1ff");

                if (wasPublishing) {
                    const userId = this.core.networkManager?.userId || this.core.networkManager?.userData?.id || null;
                    const authorName = this.core.networkManager?.userData?.nickname || this.core.gameManager?.player?.name || "Guest";
                    this.addChatMessage("System", `Publishing "${layout.name}"...`, "#60c1ff");
                    this.hideBaseLayoutDialog();
                    save.disabled = false;
                    save.textContent = originalButtonText;

                    (async () => {
                        let result = null;
                        try {
                            result = await publishBaseLayout({
                                userId,
                                authorName,
                                name: layout.name,
                                snapshot: layout.snapshot,
                                buildings: layout.buildings,
                                isPublic: true
                            });
                        } catch (error) {
                            this.addChatMessage(
                                "System",
                                "Could not publish base (network error).",
                                "#ffcc66"
                            );
                            return;
                        }

                        if (result?.success) {
                            this.addChatMessage("System", `Base "${layout.name}" published.`, "#7CFC00");
                        } else {
                            const reason = String(result?.error?.message || result?.error?.details || result?.error || "").trim();
                            this.addChatMessage(
                                "System",
                                reason ? `Could not publish base: ${reason}` : "Could not publish base (check DB table/config).",
                                "#ffcc66"
                            );
                        }
                    })();
                    return;
                }

                this.hideBaseLayoutDialog();
                save.disabled = false;
                save.textContent = originalButtonText;
            } finally {
                clearTimeout(watchdogId);
            }
        });

        actions.appendChild(cancel);
        actions.appendChild(save);
        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(input);
        card.appendChild(publishRow);
        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        this.baseLayoutDialogElement = overlay;
        this.baseLayoutDialogCleanup = null;

        input.focus();
        input.select();
    }

    showLoadBaseLayoutDialog () {
        this.tutorialActionMarks.loadBaseAt = Date.now();
        this.hideBaseLayoutDialog();

        let localLayouts = this.getSavedBaseLayouts();
        let publicLayouts = [];
        let publicLayoutCache = {};
        let activeSource = "local";
        let visibleLayouts = [];
        let layoutLoadInFlight = false;
        let draggedLocalLayoutKey = null;
        let isCapturingLayoutKey = false;
        let pendingLayoutKeyCapture = null;
        const loadPublicHotkeyMap = () => this.getSavedPublicBaseHotkeys();
        const savePublicHotkeyMap = (map) => this.setSavedPublicBaseHotkeys(map);
        let publicLayoutHotkeys = loadPublicHotkeyMap();
        let publicLayoutHotkeyMeta = this.getSavedPublicBaseHotkeyMeta();

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0, 0, 0, 0.5)";
        overlay.style.zIndex = "20020";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.pointerEvents = "all";

        const card = document.createElement("div");
        card.style.width = "min(760px, 96vw)";
        card.style.maxHeight = "86vh";
        card.style.overflow = "hidden";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.background = "linear-gradient(145deg, rgba(9,17,34,0.97), rgba(16,30,58,0.97))";
        card.style.border = "2px solid rgba(102, 225, 255, 0.65)";
        card.style.borderRadius = "14px";
        card.style.padding = "16px";
        card.style.color = "#eaf6ff";
        card.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "LOAD BASE";
        title.style.fontSize = "20px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "1px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = "Pick a source and load a base layout.";
        subtitle.style.marginTop = "6px";
        subtitle.style.fontSize = "13px";
        subtitle.style.opacity = "0.92";

        const tabsRow = document.createElement("div");
        tabsRow.style.marginTop = "10px";
        tabsRow.style.display = "flex";
        tabsRow.style.gap = "8px";

        const createTabButton = (label, source) => {
            const btn = document.createElement("button");
            btn.textContent = label;
            btn.style.border = "1px solid rgba(120, 180, 255, 0.55)";
            btn.style.background = "rgba(10,22,48,0.65)";
            btn.style.color = "#eaf6ff";
            btn.style.padding = "7px 12px";
            btn.style.borderRadius = "9px";
            btn.style.cursor = "pointer";
            btn.style.fontWeight = "700";
            btn.addEventListener("click", async () => {
                activeSource = source;
                updateTabStyles();
                await renderLayouts(searchInput.value);
            });
            return btn;
        };

        const localTab = createTabButton("Local", "local");
        const publicTab = createTabButton("Public", "public");
        tabsRow.appendChild(localTab);
        tabsRow.appendChild(publicTab);

        const updateTabStyles = () => {
            const activeStyle = "linear-gradient(135deg, rgba(33, 180, 118, 0.45), rgba(41, 225, 132, 0.25))";
            const inactiveStyle = "rgba(10,22,48,0.65)";
            localTab.style.background = activeSource === "local" ? activeStyle : inactiveStyle;
            publicTab.style.background = activeSource === "public" ? activeStyle : inactiveStyle;
        };
        updateTabStyles();

        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Search base layout...";
        searchInput.style.width = "100%";
        searchInput.style.marginTop = "10px";
        searchInput.style.height = "38px";
        searchInput.style.borderRadius = "10px";
        searchInput.style.border = "1px solid rgba(120, 180, 255, 0.55)";
        searchInput.style.background = "rgba(8,18,40,0.65)";
        searchInput.style.color = "#eaf6ff";
        searchInput.style.padding = "0 12px";
        searchInput.style.outline = "none";
        searchInput.style.boxSizing = "border-box";

        const hotkeyHint = document.createElement("div");
        hotkeyHint.style.marginTop = "8px";
        hotkeyHint.style.fontSize = "12px";
        hotkeyHint.style.opacity = "0.86";
        hotkeyHint.style.letterSpacing = "0.03em";
        hotkeyHint.textContent = "Local: drag the grip icon to reorder, click Key to set a shortcut (keyboard or mouse side button).";

        const list = document.createElement("div");
        list.style.marginTop = "12px";
        list.style.maxHeight = "none";
        list.style.minHeight = "140px";
        list.style.flex = "1 1 auto";
        list.style.minWidth = "0";
        list.style.overflowY = "auto";
        list.style.display = "grid";
        list.style.gap = "10px";
        list.style.paddingRight = "4px";
        let renderRequestId = 0;

        const ensureLoadBaseLoadingStyles = () => {
            if (document.getElementById("warhex-load-base-loading-style")) return;
            const styleElement = document.createElement("style");
            styleElement.id = "warhex-load-base-loading-style";
            styleElement.textContent = `
                @keyframes warhexLoadBaseShimmer {
                    0% { background-position: 200% 0; }
                    100% { background-position: -200% 0; }
                }
                .warhex-load-base-skeleton {
                    background: linear-gradient(
                        90deg,
                        rgba(35, 63, 108, 0.28) 0%,
                        rgba(110, 181, 255, 0.34) 50%,
                        rgba(35, 63, 108, 0.28) 100%
                    );
                    background-size: 240% 100%;
                    animation: warhexLoadBaseShimmer 1.25s linear infinite;
                }
                .warhex-load-base-preview-loading {
                    background: linear-gradient(
                        90deg,
                        rgba(12, 31, 66, 0.35) 0%,
                        rgba(54, 127, 216, 0.42) 50%,
                        rgba(12, 31, 66, 0.35) 100%
                    );
                    background-size: 220% 100%;
                    animation: warhexLoadBaseShimmer 1.2s linear infinite;
                }
            `;
            document.head.appendChild(styleElement);
        };
        ensureLoadBaseLoadingStyles();

        const renderLoadingRows = (message = "Loading layouts...") => {
            list.innerHTML = "";

            const header = document.createElement("div");
            header.textContent = message;
            header.style.fontSize = "12px";
            header.style.fontWeight = "700";
            header.style.opacity = "0.86";
            header.style.marginBottom = "2px";
            list.appendChild(header);

            for (let i = 0; i < 3; i++) {
                const item = document.createElement("div");
                item.style.display = "grid";
                item.style.gridTemplateColumns = "180px 1fr auto";
                item.style.gap = "10px";
                item.style.alignItems = "center";
                item.style.padding = "10px";
                item.style.border = "1px solid rgba(120, 180, 255, 0.3)";
                item.style.borderRadius = "10px";
                item.style.background = "rgba(10, 22, 48, 0.45)";

                const previewSkeleton = document.createElement("div");
                previewSkeleton.className = "warhex-load-base-skeleton";
                previewSkeleton.style.width = "180px";
                previewSkeleton.style.height = "100px";
                previewSkeleton.style.borderRadius = "8px";
                previewSkeleton.style.border = "1px solid rgba(120, 180, 255, 0.25)";

                const info = document.createElement("div");
                info.style.display = "grid";
                info.style.gap = "8px";

                const titleLine = document.createElement("div");
                titleLine.className = "warhex-load-base-skeleton";
                titleLine.style.height = "18px";
                titleLine.style.width = "60%";
                titleLine.style.borderRadius = "6px";

                const metaLine = document.createElement("div");
                metaLine.className = "warhex-load-base-skeleton";
                metaLine.style.height = "12px";
                metaLine.style.width = "90%";
                metaLine.style.borderRadius = "6px";

                info.appendChild(titleLine);
                info.appendChild(metaLine);

                const actionSkeleton = document.createElement("div");
                actionSkeleton.className = "warhex-load-base-skeleton";
                actionSkeleton.style.width = "64px";
                actionSkeleton.style.height = "36px";
                actionSkeleton.style.borderRadius = "9px";

                item.appendChild(previewSkeleton);
                item.appendChild(info);
                item.appendChild(actionSkeleton);
                list.appendChild(item);
            }
        };

        const withUiTimeout = (promise, ms = 9000, timeoutMessage = "public_layouts_timeout") => {
            let timeoutId = null;
            return Promise.race([
                promise,
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
                })
            ]).finally(() => {
                if (timeoutId) clearTimeout(timeoutId);
            });
        };

        const normalizeLayout = (layout) => this.normalizeBaseLayoutForLoading(layout);

        const getLayoutKey = (layout) => {
            return this.getBaseLayoutEntryKey(layout);
        };

        const clearPendingLayoutKeyCapture = () => {
            if (typeof pendingLayoutKeyCapture === "function") {
                pendingLayoutKeyCapture();
            }
            pendingLayoutKeyCapture = null;
            isCapturingLayoutKey = false;
        };

        const setLocalLayoutHotkey = (layout, keyValue) => {
            const targetKey = getLayoutKey(layout);
            const normalizedHotkey = this.normalizeKeybindValue(keyValue);
            const next = this.getSavedBaseLayouts().map(item => ({ ...item }));
            const targetIndex = next.findIndex(item => getLayoutKey(item) === targetKey);
            if (targetIndex < 0) return false;

            next[targetIndex].hotkey = normalizedHotkey;
            this.setSavedBaseLayouts(next);
            localLayouts = next;
            return true;
        };

        const setPublicLayoutHotkey = (layout, keyValue) => {
            const targetKey = getLayoutKey(layout);
            if (!targetKey) return false;
            const normalizedHotkey = this.normalizeKeybindValue(keyValue);
            const next = { ...publicLayoutHotkeys };
            if (normalizedHotkey) {
                next[targetKey] = normalizedHotkey;
                publicLayoutHotkeyMeta[targetKey] = {
                    id: layout?.id ?? null,
                    name: layout?.name || "Public Base",
                    createdAt: layout?.createdAt || layout?.created_at || null
                };
            } else {
                delete next[targetKey];
                delete publicLayoutHotkeyMeta[targetKey];
            }
            publicLayoutHotkeys = next;
            this.setSavedPublicBaseHotkeyMeta(publicLayoutHotkeyMeta);
            savePublicHotkeyMap(next);
            return true;
        };

        const getLayoutHotkey = (layout, source) => {
            if (source === "local") {
                return this.normalizeKeybindValue(layout?.hotkey || "");
            }
            return this.normalizeKeybindValue(publicLayoutHotkeys[getLayoutKey(layout)] || "");
        };

        const setLayoutHotkey = (layout, source, keyValue) => {
            if (source === "local") return setLocalLayoutHotkey(layout, keyValue);
            if (source === "public") return setPublicLayoutHotkey(layout, keyValue);
            return false;
        };

        const normalizeMouseButtonHotkey = (button) => {
            const buttonIndex = Number(button);
            if (!Number.isInteger(buttonIndex) || buttonIndex < 0) return "";
            return `mouse${buttonIndex + 1}`;
        };

        const findLayoutHotkeyConflict = (layout, source, keyValue) => {
            const normalizedHotkey = this.normalizeKeybindValue(keyValue);
            if (!normalizedHotkey) return null;

            const targetKey = getLayoutKey(layout);
            return this.findConfiguredKeyConflict(normalizedHotkey, {
                excludeScope: source === "public" ? "base-public" : "base-local",
                excludeId: targetKey
            });
        };

        const applyLayoutHotkey = (layout, source, keyValue) => {
            const normalizedHotkey = this.normalizeKeybindValue(keyValue);
            if (!normalizedHotkey) {
                return { ok: setLayoutHotkey(layout, source, "") };
            }

            if (this.isReservedGameplayKeybind(normalizedHotkey)) {
                this.notifySystemWarning(this.getReservedGameplayKeybindNotice(normalizedHotkey));
                return { ok: false, reserved: true };
            }

            const conflict = findLayoutHotkeyConflict(layout, source, normalizedHotkey);
            if (conflict) {
                this.showKeyConflictNotice(normalizedHotkey, conflict, { assigned: true });
            }

            return { ok: setLayoutHotkey(layout, source, normalizedHotkey), conflict: Boolean(conflict) };
        };

        const beginLayoutHotkeyCapture = (layout, source, keyBtn) => {
            clearPendingLayoutKeyCapture();
            isCapturingLayoutKey = true;
            keyBtn.textContent = "Press key/mouse...";

            const finalizeCapture = async () => {
                clearPendingLayoutKeyCapture();
                await renderLayouts(searchInput.value);
            };

            const onKeyCapture = async (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                const pressed = this.normalizeKeybindValue(event.key);
                if (!pressed) return;

                if (pressed === "escape") {
                    await finalizeCapture();
                    return;
                }
                if (pressed === "backspace" || pressed === "delete") {
                    setLayoutHotkey(layout, source, "");
                    await finalizeCapture();
                    return;
                }
                applyLayoutHotkey(layout, source, pressed);
                await finalizeCapture();
            };

            const onMouseCapture = async (event) => {
                const pressed = normalizeMouseButtonHotkey(event.button);
                if (!pressed || event.button < 3) return;
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                applyLayoutHotkey(layout, source, pressed);
                await finalizeCapture();
            };

            document.addEventListener("keydown", onKeyCapture, true);
            document.addEventListener("mousedown", onMouseCapture, true);
            pendingLayoutKeyCapture = () => {
                document.removeEventListener("keydown", onKeyCapture, true);
                document.removeEventListener("mousedown", onMouseCapture, true);
            };
        };

        const reorderLocalLayouts = (dragKey, targetKey) => {
            if (!dragKey || !targetKey || dragKey === targetKey) return false;
            const next = this.getSavedBaseLayouts().map(item => ({ ...item }));
            const fromIndex = next.findIndex(item => getLayoutKey(item) === dragKey);
            const toIndex = next.findIndex(item => getLayoutKey(item) === targetKey);
            if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false;
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            this.setSavedBaseLayouts(next);
            localLayouts = next;
            return true;
        };

        const loadLayoutFromDialog = async (layout, source, triggerButton = null) => {
            if (!layout || layoutLoadInFlight) return false;
            const button = triggerButton || null;
            const oldText = button ? button.textContent : "";
            layoutLoadInFlight = true;
            if (button) {
                button.disabled = true;
                button.textContent = "Loading...";
            }
            try {
                let layoutToLoad = this.normalizeBaseLayoutForLoading(layout);
                const hasBuildings = Array.isArray(layoutToLoad?.buildings) && layoutToLoad.buildings.length > 0;
                if (source === "public" && !hasBuildings) {
                    const detailResult = await fetchPublicBaseLayoutByIdSafe(layout.id);
                    if (!detailResult?.success || !detailResult?.data) {
                        this.notifySystemWarning("Could not load this public base.");
                        return false;
                    }
                    const details = detailResult.data;
                    layoutToLoad = this.normalizeBaseLayoutForLoading({
                        ...layout,
                        ...details
                    });
                }
                if (!Array.isArray(layoutToLoad?.buildings) || layoutToLoad.buildings.length === 0) {
                    this.notifySystemWarning("Layout has no buildings to load.");
                    return false;
                }
                this.hideBaseLayoutDialog();
                this.core.buildingManager.loadBaseLayout(layoutToLoad);
                return true;
            } finally {
                layoutLoadInFlight = false;
                if (button) {
                    button.disabled = false;
                    button.textContent = oldText;
                }
            }
        };

        const renderLayouts = async (queryText = "") => {
            const requestId = ++renderRequestId;
            try {
                list.innerHTML = "";
                visibleLayouts = [];
                const query = (queryText || "").trim();
                let filtered = [];

                if (activeSource === "public") {
                    renderLoadingRows("Loading public layouts...");
                    const response = await withUiTimeout(fetchPublicBaseLayouts(query, 40), 9000);
                    if (requestId !== renderRequestId) return;

                    const responseRows = Array.isArray(response?.data)
                        ? response.data.filter((row) => row && typeof row === "object")
                        : [];
                    if (!response?.success && responseRows.length === 0) {
                        const errorMessage = String(response?.error?.message || response?.error || "public_layouts_failed");
                        throw new Error(errorMessage);
                    }

                    publicLayouts = responseRows.map(normalizeLayout);
                    publicLayouts.forEach((layout) => {
                        publicLayoutCache[getLayoutKey(layout)] = layout;
                    });
                    const nextMeta = { ...publicLayoutHotkeyMeta };
                    publicLayouts.forEach((layout) => {
                        const layoutKey = getLayoutKey(layout);
                        nextMeta[layoutKey] = {
                            id: layout?.id ?? null,
                            name: layout?.name || "Public Base",
                            createdAt: layout?.createdAt || layout?.created_at || null
                        };
                    });
                    publicLayoutHotkeyMeta = nextMeta;
                    this.setSavedPublicBaseHotkeyMeta(nextMeta);
                    filtered = publicLayouts.map((layout) => ({
                        ...layout,
                        hotkey: getLayoutHotkey(layout, "public")
                    }));
                } else {
                    const q = query.toLowerCase();
                    filtered = !q
                        ? localLayouts.map(normalizeLayout)
                        : localLayouts.map(normalizeLayout).filter(layout => layout.name.toLowerCase().includes(q));
                    filtered = filtered.map((layout) => ({
                        ...layout,
                        hotkey: getLayoutHotkey(layout, "local")
                    }));
                }

                hotkeyHint.textContent = activeSource === "local"
                    ? "Local: drag the grip icon to reorder, click Key to set a shortcut (keyboard or mouse side button), then press it to load."
                    : "Public: click Key to set a shortcut (keyboard or mouse side button), then press it to load.";
                visibleLayouts = filtered;

                // Replace loading skeleton/content from previous render before drawing final rows.
                list.innerHTML = "";

                if (filtered.length === 0) {
                    visibleLayouts = [];
                    const empty = document.createElement("div");
                    empty.textContent = (activeSource === "local" ? localLayouts.length : publicLayouts.length) === 0
                        ? "No saved layouts yet."
                        : "No layouts match your search.";
                    empty.style.padding = "14px";
                    empty.style.border = "1px dashed rgba(120, 180, 255, 0.45)";
                    empty.style.borderRadius = "10px";
                    empty.style.opacity = "0.9";
                    list.appendChild(empty);
                    return;
                }

                filtered.forEach((layout) => {
                const layoutSource = activeSource;
                const localLayoutKey = layoutSource === "local" ? getLayoutKey(layout) : "";
                const item = document.createElement("div");
                item.style.display = "grid";
                item.style.gridTemplateColumns = "180px 1fr auto";
                item.style.gap = "10px";
                item.style.alignItems = "center";
                item.style.padding = "10px";
                item.style.border = "1px solid rgba(120, 180, 255, 0.4)";
                item.style.borderRadius = "10px";
                item.style.background = "rgba(10, 22, 48, 0.55)";
                const resetItemBorder = () => {
                    item.style.border = "1px solid rgba(120, 180, 255, 0.4)";
                };

                if (layoutSource === "local") {
                    item.draggable = true;
                    item.addEventListener("dragstart", (event) => {
                        draggedLocalLayoutKey = localLayoutKey;
                        item.style.opacity = "0.72";
                        if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", localLayoutKey);
                        }
                    });
                    item.addEventListener("dragend", () => {
                        draggedLocalLayoutKey = null;
                        item.style.opacity = "1";
                        resetItemBorder();
                    });
                    item.addEventListener("dragover", (event) => {
                        if (!draggedLocalLayoutKey || draggedLocalLayoutKey === localLayoutKey) return;
                        event.preventDefault();
                        item.style.border = "1px solid rgba(255, 210, 120, 0.95)";
                    });
                    item.addEventListener("dragleave", () => {
                        resetItemBorder();
                    });
                    item.addEventListener("drop", async (event) => {
                        if (!draggedLocalLayoutKey || draggedLocalLayoutKey === localLayoutKey) return;
                        event.preventDefault();
                        event.stopPropagation();
                        resetItemBorder();
                        const changed = reorderLocalLayouts(draggedLocalLayoutKey, localLayoutKey);
                        draggedLocalLayoutKey = null;
                        if (changed) {
                            await renderLayouts(searchInput.value);
                        }
                    });
                }

                const preview = document.createElement("div");
                preview.style.width = "180px";
                preview.style.height = "100px";
                preview.style.borderRadius = "8px";
                preview.style.overflow = "hidden";
                preview.style.border = "1px solid rgba(120, 180, 255, 0.35)";
                preview.style.background = "rgba(4, 12, 28, 0.7)";

                const noPreviewLabel = document.createElement("div");
                noPreviewLabel.textContent = "No preview";
                noPreviewLabel.style.width = "100%";
                noPreviewLabel.style.height = "100%";
                noPreviewLabel.style.display = "grid";
                noPreviewLabel.style.placeItems = "center";
                noPreviewLabel.style.fontSize = "12px";
                noPreviewLabel.style.opacity = "0.65";
                noPreviewLabel.style.letterSpacing = "0.03em";

                const img = document.createElement("img");
                img.alt = layout.name || "Base";
                img.style.width = "100%";
                img.style.height = "100%";
                img.style.objectFit = "contain";
                img.style.objectPosition = "center";
                img.style.background = "rgba(4, 12, 28, 0.7)";
                img.style.display = "none";
                img.onerror = () => {
                    img.style.display = "none";
                    noPreviewLabel.classList.remove("warhex-load-base-preview-loading");
                    noPreviewLabel.textContent = "No preview";
                    if (!preview.contains(noPreviewLabel)) preview.appendChild(noPreviewLabel);
                };

                const applySnapshotToPreview = (snapshotValue) => {
                    const normalizedSnapshot = this.normalizeBaseLayoutSnapshot(snapshotValue);
                    if (!normalizedSnapshot) return false;
                    img.src = normalizedSnapshot;
                    img.style.display = "block";
                    noPreviewLabel.classList.remove("warhex-load-base-preview-loading");
                    if (preview.contains(noPreviewLabel)) preview.removeChild(noPreviewLabel);
                    if (!preview.contains(img)) preview.appendChild(img);
                    layout.snapshot = normalizedSnapshot;
                    return true;
                };

                if (!applySnapshotToPreview(layout.snapshot)) {
                    preview.appendChild(noPreviewLabel);
                }

                const info = document.createElement("div");
                const nameRow = document.createElement("div");
                nameRow.style.display = "flex";
                nameRow.style.alignItems = "center";
                nameRow.style.gap = "8px";
                if (layoutSource === "local") {
                    const dragHandle = document.createElement("span");
                    dragHandle.textContent = "↕";
                    dragHandle.title = "Drag to reorder";
                    dragHandle.style.display = "inline-grid";
                    dragHandle.style.placeItems = "center";
                    dragHandle.style.width = "22px";
                    dragHandle.style.height = "22px";
                    dragHandle.style.borderRadius = "6px";
                    dragHandle.style.border = "1px solid rgba(255, 210, 120, 0.65)";
                    dragHandle.style.background = "rgba(112, 84, 32, 0.24)";
                    dragHandle.style.color = "#ffe9bc";
                    dragHandle.style.fontSize = "14px";
                    dragHandle.style.fontWeight = "900";
                    dragHandle.style.cursor = "grab";
                    nameRow.appendChild(dragHandle);
                }
                const name = document.createElement("div");
                name.textContent = layout.name || "Unnamed Base";
                name.style.fontSize = "16px";
                name.style.fontWeight = "800";
                nameRow.appendChild(name);
                const meta = document.createElement("div");
                const created = layout.createdAt ? new Date(layout.createdAt).toLocaleString() : "Unknown date";
                const count = Array.isArray(layout.buildings) ? layout.buildings.length : 0;
                const author = layout.authorName ? ` by ${layout.authorName}` : "";
                const layoutHotkeyLabel = this.formatKeybindLabel(getLayoutHotkey(layout, layoutSource) || "");
                meta.textContent = `${count} buildings - ${created}${author} - key: ${layoutHotkeyLabel}`;
                meta.style.marginTop = "6px";
                meta.style.fontSize = "12px";
                meta.style.opacity = "0.86";
                info.appendChild(nameRow);
                info.appendChild(meta);

                const actions = document.createElement("div");
                actions.style.display = "grid";
                actions.style.gap = "8px";

                if (layoutSource === "public") {
                    const keyBtn = document.createElement("button");
                    const keyLabel = this.formatKeybindLabel(getLayoutHotkey(layout, layoutSource) || "");
                    keyBtn.textContent = keyLabel === this.t("hud.none") ? "Key" : `Key: ${keyLabel}`;
                    keyBtn.style.border = "1px solid rgba(120, 255, 165, 0.75)";
                    keyBtn.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
                    keyBtn.style.color = "#e8ffef";
                    keyBtn.style.padding = "8px 12px";
                    keyBtn.style.borderRadius = "9px";
                    keyBtn.style.cursor = "pointer";
                    keyBtn.style.fontWeight = "800";
                    keyBtn.addEventListener("click", () => {
                        beginLayoutHotkeyCapture(layout, layoutSource, keyBtn);
                    });

                    const loadBtn = document.createElement("button");
                    loadBtn.textContent = "Load";
                    loadBtn.style.border = "1px solid rgba(120, 255, 165, 0.75)";
                    loadBtn.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
                    loadBtn.style.color = "#e8ffef";
                    loadBtn.style.padding = "8px 12px";
                    loadBtn.style.borderRadius = "9px";
                    loadBtn.style.cursor = "pointer";
                    loadBtn.style.fontWeight = "800";
                    loadBtn.addEventListener("click", async () => {
                        await loadLayoutFromDialog(layout, layoutSource, loadBtn);
                    });
                    actions.appendChild(keyBtn);
                    actions.appendChild(loadBtn);
                }

                if (layoutSource === "public" && !layout.snapshot && layout.id) {
                    noPreviewLabel.textContent = "Loading preview...";
                    noPreviewLabel.classList.add("warhex-load-base-preview-loading");
                    const previewTimeout = setTimeout(() => {
                        noPreviewLabel.classList.remove("warhex-load-base-preview-loading");
                        noPreviewLabel.textContent = "No preview";
                    }, 5000);
                    fetchPublicBaseLayoutByIdSafe(layout.id).then((detailResult) => {
                        clearTimeout(previewTimeout);
                        if (!detailResult?.success || !detailResult?.data) {
                            noPreviewLabel.classList.remove("warhex-load-base-preview-loading");
                            noPreviewLabel.textContent = "No preview";
                            return;
                        }
                        const didApply = applySnapshotToPreview(detailResult.data.snapshot);
                        if (!didApply) {
                            noPreviewLabel.classList.remove("warhex-load-base-preview-loading");
                            noPreviewLabel.textContent = "No preview";
                        }
                    }).catch(() => {
                        clearTimeout(previewTimeout);
                        noPreviewLabel.classList.remove("warhex-load-base-preview-loading");
                        noPreviewLabel.textContent = "No preview";
                    });
                }

                if (layoutSource === "local") {
                    const publishBtn = document.createElement("button");
                    publishBtn.textContent = "Publish";
                    publishBtn.style.border = "1px solid rgba(120, 205, 255, 0.7)";
                    publishBtn.style.background = "linear-gradient(135deg, rgba(43, 122, 255, 0.5), rgba(72, 184, 255, 0.35))";
                    publishBtn.style.color = "#eaf6ff";
                    publishBtn.style.padding = "8px 12px";
                    publishBtn.style.borderRadius = "9px";
                    publishBtn.style.cursor = "pointer";
                    publishBtn.style.fontWeight = "700";
                    publishBtn.addEventListener("click", async () => {
                        if (publishBtn.dataset.publishBusy === "1") return;
                        publishBtn.dataset.publishBusy = "1";
                        publishBtn.disabled = true;
                        const oldText = publishBtn.textContent;
                        publishBtn.textContent = "Publishing...";
                        const watchdogId = setTimeout(() => {
                            publishBtn.disabled = false;
                            publishBtn.textContent = oldText;
                            publishBtn.dataset.publishBusy = "0";
                        }, 35000);
                        try {
                            const userId = this.core.networkManager?.userId || this.core.networkManager?.userData?.id || null;
                            const authorName = this.core.networkManager?.userData?.nickname || this.core.gameManager?.player?.name || "Guest";
                            const snapshotForPublish = this.normalizeBaseLayoutSnapshot(layout.snapshot)
                                || this.normalizeBaseLayoutSnapshot(this.captureCurrentBaseSnapshot({ forceCenter: true }))
                                || this.normalizeBaseLayoutSnapshot(this.captureCurrentBaseSnapshot({ forceCenter: false }))
                                || null;
                            if (snapshotForPublish && !layout.snapshot) {
                                layout.snapshot = snapshotForPublish;
                            }
                            const result = await publishBaseLayout({
                                userId,
                                authorName,
                                name: layout.name,
                                snapshot: snapshotForPublish,
                                buildings: layout.buildings,
                                isPublic: true
                            });
                            if (result?.success) {
                                this.addChatMessage("System", `Base "${layout.name}" published.`, "#7CFC00");
                                await renderLayouts(searchInput.value);
                            } else {
                                const reason = String(result?.error?.message || result?.error?.details || result?.error || "").trim();
                                this.addChatMessage(
                                    "System",
                                    reason ? `Could not publish base: ${reason}` : "Could not publish base (check DB table/config).",
                                    "#ffcc66"
                                );
                            }
                        } catch (error) {
                            this.addChatMessage(
                                "System",
                                "Could not publish base (network error).",
                                "#ffcc66"
                            );
                        } finally {
                            clearTimeout(watchdogId);
                            publishBtn.disabled = false;
                            publishBtn.textContent = oldText;
                            publishBtn.dataset.publishBusy = "0";
                        }
                    });

                    const keyBtn = document.createElement("button");
                    const keyLabel = this.formatKeybindLabel(getLayoutHotkey(layout, layoutSource) || "");
                    keyBtn.textContent = keyLabel === this.t("hud.none") ? "Key" : `Key: ${keyLabel}`;
                    keyBtn.style.border = "1px solid rgba(120, 255, 165, 0.75)";
                    keyBtn.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
                    keyBtn.style.color = "#e8ffef";
                    keyBtn.style.padding = "8px 12px";
                    keyBtn.style.borderRadius = "9px";
                    keyBtn.style.cursor = "pointer";
                    keyBtn.style.fontWeight = "800";
                    keyBtn.addEventListener("click", () => {
                        beginLayoutHotkeyCapture(layout, layoutSource, keyBtn);
                    });

                    const deleteBtn = document.createElement("button");
                    deleteBtn.textContent = "Delete";
                    deleteBtn.style.border = "1px solid rgba(255, 130, 130, 0.65)";
                    deleteBtn.style.background = "rgba(120, 36, 36, 0.25)";
                    deleteBtn.style.color = "#ffd6d6";
                    deleteBtn.style.padding = "8px 12px";
                    deleteBtn.style.borderRadius = "9px";
                    deleteBtn.style.cursor = "pointer";
                    deleteBtn.addEventListener("click", () => {
                        const targetKey = getLayoutKey(layout);
                        const remaining = this.getSavedBaseLayouts().filter(item => getLayoutKey(item) !== targetKey);
                        this.setSavedBaseLayouts(remaining);
                        this.showLoadBaseLayoutDialog();
                    });
                    actions.appendChild(keyBtn);
                    actions.appendChild(publishBtn);
                    actions.appendChild(deleteBtn);
                }

                item.appendChild(preview);
                item.appendChild(info);
                item.appendChild(actions);
                list.appendChild(item);
                });
            } catch (error) {
                if (requestId !== renderRequestId) return;
                list.innerHTML = "";
                visibleLayouts = [];
                const isTimeout = String(error?.message || "").toLowerCase().includes("timeout");
                const errorInfo = document.createElement("div");
                errorInfo.textContent = isTimeout
                    ? "Public base loading timed out. Please try again."
                    : "Could not load public bases.";
                errorInfo.style.padding = "14px";
                errorInfo.style.border = "1px dashed rgba(255, 140, 140, 0.45)";
                errorInfo.style.borderRadius = "10px";
                errorInfo.style.opacity = "0.9";
                list.appendChild(errorInfo);
            }
        };

        searchInput.addEventListener("input", async () => {
            await renderLayouts(searchInput.value);
        });
        renderLayouts();

        const onDialogKeyDown = async (event) => {
            if (!this.baseLayoutDialogElement || !this.baseLayoutDialogElement.parentNode) return;
            if (event.repeat) return;
            if (isCapturingLayoutKey) return;

            const key = this.normalizeKeybindValue(event.key);
            if (!key) return;
            const sourceLayouts = activeSource === "public"
                ? Object.values(publicLayoutCache).map(normalizeLayout)
                : localLayouts.map(normalizeLayout);
            const selectedLayout = visibleLayouts.find((layout) => {
                const layoutKey = this.normalizeKeybindValue(layout?.hotkey || "");
                return layoutKey && layoutKey === key;
            }) || sourceLayouts.find((layout) => {
                const layoutKey = getLayoutHotkey(layout, activeSource);
                return layoutKey && layoutKey === key;
            });
            if (selectedLayout) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                await loadLayoutFromDialog(selectedLayout, activeSource, null);
            }
        };

        const onDialogMouseDown = async (event) => {
            if (!this.baseLayoutDialogElement || !this.baseLayoutDialogElement.parentNode) return;
            if (isCapturingLayoutKey) return;

            const key = normalizeMouseButtonHotkey(event.button);
            if (!key || event.button < 3) return;
            const sourceLayouts = activeSource === "public"
                ? Object.values(publicLayoutCache).map(normalizeLayout)
                : localLayouts.map(normalizeLayout);
            const selectedLayout = visibleLayouts.find((layout) => {
                const layoutKey = this.normalizeKeybindValue(layout?.hotkey || "");
                return layoutKey && layoutKey === key;
            }) || sourceLayouts.find((layout) => {
                const layoutKey = getLayoutHotkey(layout, activeSource);
                return layoutKey && layoutKey === key;
            });
            if (selectedLayout) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation?.();
                await loadLayoutFromDialog(selectedLayout, activeSource, null);
            }
        };

        document.addEventListener("keydown", onDialogKeyDown, true);
        document.addEventListener("mousedown", onDialogMouseDown, true);

        const closeRow = document.createElement("div");
        closeRow.style.marginTop = "10px";
        closeRow.style.flex = "0 0 auto";
        closeRow.style.display = "flex";
        closeRow.style.justifyContent = "flex-end";

        const closeButton = document.createElement("button");
        closeButton.textContent = "Close";
        closeButton.style.border = "1px solid rgba(255, 130, 130, 0.65)";
        closeButton.style.background = "rgba(120, 36, 36, 0.25)";
        closeButton.style.color = "#ffd6d6";
        closeButton.style.padding = "10px 16px";
        closeButton.style.borderRadius = "10px";
        closeButton.style.cursor = "pointer";
        closeButton.addEventListener("click", () => this.hideBaseLayoutDialog());
        closeRow.appendChild(closeButton);

        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(tabsRow);
        card.appendChild(searchInput);
        card.appendChild(hotkeyHint);
        card.appendChild(list);
        card.appendChild(closeRow);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        this.baseLayoutDialogElement = overlay;
        this.baseLayoutDialogCleanup = () => {
            document.removeEventListener("keydown", onDialogKeyDown, true);
            document.removeEventListener("mousedown", onDialogMouseDown, true);
            clearPendingLayoutKeyCapture();
        };
    }

    showRelocateBasePrompt(cost, onConfirm, onCancel) {
        this.hideRelocateBasePrompt();

        const panel = document.createElement("div");
        panel.style.position = "fixed";
        panel.style.top = "8px";
        panel.style.left = "8px";
        panel.style.zIndex = "20997";
        panel.style.width = "min(300px, calc(100vw - 18px))";
        panel.style.pointerEvents = "all";
        panel.style.background = "linear-gradient(180deg, rgba(22,8,46,0.96), rgba(12,6,28,0.96))";
        panel.style.border = "1px solid rgba(183, 123, 255, 0.48)";
        panel.style.borderRadius = "10px";
        panel.style.padding = "8px";
        panel.style.boxShadow = "0 8px 20px rgba(0,0,0,0.36), 0 0 14px rgba(174, 96, 255, 0.2)";
        panel.style.color = "#efe6ff";
        panel.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "RELOCATE BASE";
        title.style.fontSize = "15px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "0.2px";
        title.style.color = "#efe6ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = `Confirm relocation for ${cost} power?`;
        subtitle.style.marginTop = "4px";
        subtitle.style.fontSize = "12px";
        subtitle.style.fontWeight = "700";
        subtitle.style.color = "#d9c6ff";

        const description = document.createElement("div");
        description.textContent = "Your base and owned entities will move to the selected empty slot.";
        description.style.marginTop = "2px";
        description.style.fontSize = "11px";
        description.style.opacity = "0.92";

        const actions = document.createElement("div");
        actions.style.marginTop = "8px";
        actions.style.display = "flex";
        actions.style.gap = "8px";
        actions.style.justifyContent = "flex-end";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Cancel";
        cancelButton.style.border = "1px solid rgba(206, 141, 255, 0.48)";
        cancelButton.style.background = "rgba(57, 24, 86, 0.8)";
        cancelButton.style.color = "#f3e9ff";
        cancelButton.style.fontSize = "12px";
        cancelButton.style.fontWeight = "700";
        cancelButton.style.padding = "6px 10px";
        cancelButton.style.borderRadius = "7px";
        cancelButton.style.cursor = "pointer";

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.textContent = "Relocate";
        confirmButton.style.border = "1px solid rgba(120, 255, 165, 0.75)";
        confirmButton.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
        confirmButton.style.color = "#e8ffef";
        confirmButton.style.fontSize = "12px";
        confirmButton.style.fontWeight = "800";
        confirmButton.style.padding = "6px 10px";
        confirmButton.style.borderRadius = "7px";
        confirmButton.style.cursor = "pointer";

        cancelButton.addEventListener("click", () => {
            this.hideRelocateBasePrompt();
            if (typeof onCancel === "function") onCancel();
        });

        confirmButton.addEventListener("click", () => {
            this.hideRelocateBasePrompt();
            if (typeof onConfirm === "function") onConfirm();
        });

        actions.appendChild(cancelButton);
        actions.appendChild(confirmButton);
        panel.appendChild(title);
        panel.appendChild(subtitle);
        panel.appendChild(description);
        panel.appendChild(actions);

        document.body.appendChild(panel);
        this.relocatePromptElement = panel;
    }

    hideRelocateBasePrompt() {
        if (this.relocatePromptElement && this.relocatePromptElement.parentNode) {
            this.relocatePromptElement.parentNode.removeChild(this.relocatePromptElement);
        }
        this.relocatePromptElement = null;
    }

    showX1DuelStatus(opponentName, prepSeconds = 0) {
        this.hideX1DuelStatus();

        const badge = document.createElement("div");
        badge.style.position = "fixed";
        badge.style.left = "50%";
        badge.style.top = "22px";
        badge.style.transform = "translateX(-50%)";
        badge.style.zIndex = "20010";
        badge.style.padding = "12px 16px";
        badge.style.borderRadius = "12px";
        badge.style.border = "2px solid rgba(102, 255, 189, 0.75)";
        badge.style.background = "linear-gradient(135deg, rgba(16, 35, 27, 0.92), rgba(12, 54, 39, 0.92))";
        badge.style.color = "#e8ffef";
        badge.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";
        badge.style.boxShadow = "0 8px 25px rgba(0,0,0,0.45), 0 0 18px rgba(80,255,167,0.2)";
        badge.style.pointerEvents = "none";
        badge.style.textAlign = "center";

        const title = document.createElement("div");
        title.style.fontWeight = "900";
        title.style.fontSize = "16px";
        title.style.letterSpacing = "0.4px";
        title.textContent = `${opponentName} accepted your X1`;

        const subtitle = document.createElement("div");
        subtitle.style.marginTop = "4px";
        subtitle.style.fontSize = "13px";
        subtitle.style.color = "#c7ffe0";

        const updateText = () => {
            subtitle.textContent = "Protected duel started. Fight now.";
        };

        updateText();
        badge.appendChild(title);
        badge.appendChild(subtitle);
        document.body.appendChild(badge);
        this.x1StatusElement = badge;

        setTimeout(() => this.hideX1DuelStatus(), 3500);
    }

    hideX1DuelStatus() {
        if (this.x1StatusInterval) {
            clearInterval(this.x1StatusInterval);
            this.x1StatusInterval = null;
        }
        if (this.x1StatusElement && this.x1StatusElement.parentNode) {
            this.x1StatusElement.parentNode.removeChild(this.x1StatusElement);
        }
        this.x1StatusElement = null;
    }

    showInactivityWarning() {
        const warning = this.DOM?.game?.inactivityWarning;
        if (!warning?.container || !warning?.timer) return;

        // Server may resend warning events; keep the same countdown running.
        if (warning.container.style.display === 'flex' && this.inactivityTimerInterval) {
            return;
        }

        if (this.inactivityTimerInterval) {
            clearInterval(this.inactivityTimerInterval);
            this.inactivityTimerInterval = null;
        }

        warning.container.style.display = 'flex';
        let timeLeft = this.inactivityTimeout;

        const updateTimer = () => {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = Math.max(0, timeLeft % 60);
            warning.timer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            if (timeLeft <= 0) {
                clearInterval(this.inactivityTimerInterval);
                this.inactivityTimerInterval = null;
                return;
            }
            timeLeft--;
        };

        updateTimer();
        this.inactivityTimerInterval = setInterval(updateTimer, 1000);
    }

    hideInactivityWarning() {
        this.DOM.game.inactivityWarning.container.style.display = 'none';
        if (this.inactivityTimerInterval) {
            clearInterval(this.inactivityTimerInterval);
            this.inactivityTimerInterval = null;
        }
    }
}




