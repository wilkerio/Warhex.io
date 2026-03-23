import Network from "../../network/Network.js";
import Message from "../../network/Message.js";
import { BuildingPlacementFailReasons, BuildingTypes, BuildingVariantTypes, ErrorCodes, MessageTypes, UnitTypes, UnitVariantTypes, getBulletDetails } from "../../network/constants.js";
import Player from "../../entities/Player.js";
import NeutralBase from "../../entities/objective/NeutralBase.js";
import { QueueType } from "../Renderer.js";
import Particle from "../../entities/effects/Particle.js";
import Bullet from "../../entities/Bullet.js";
import { BuildingManager } from "./BuildingManager.js";
import UnitManager from "./UnitManager.js";
import Explosion from "../../entities/effects/Explosion.js";
import Bush from "../../entities/Bush.js";
import Rock from "../../entities/Rock.js";
import WildPortal from "../../entities/objective/WildPortal.js";
import SkinCache from "../SkinCache.js";
import { clearLocalAuthState, consumeOAuthCallbackSession, ensureUserRow, fetchSkins, fetchUserRowById, invalidateGlobalLeaderboardCache, signUp, signIn, signOut, getCurrentUser, onAuthStateChange, supabase, restoreSessionFromStorage, updateUserProgressStats, updateUserProgressStatsKeepalive } from "../../network/supabaseClient.js";

const JOIN_SECURITY_FLAG_UNAUTHORIZED_EXTENSION = 0x80;
const KNOWN_GAME_EDITING_EXTENSIONS = [
    { label: "Tampermonkey", tokens: ["tampermonkey", "tampermonk", "tempermonkey", "tempermonk"] },
    { label: "Violentmonkey", tokens: ["violentmonkey", "violetmonkey", "violetnmonkey", "violetn"] },
    { label: "Greasemonkey", tokens: ["greasemonkey"] },
    { label: "Userscripts", tokens: ["userscripts"] },
    { label: "FireMonkey", tokens: ["firemonkey"] },
    { label: "OrangeMonkey", tokens: ["orangemonkey"] },
    { label: "ScriptCat", tokens: ["scriptcat"] },
    { label: "Resoluce/Override Tool", tokens: ["resoluce", "resourceoverride"] },
    { label: "User JavaScript and CSS", tokens: ["user javascript and css"] },
    { label: "Custom JavaScript for Websites 2", tokens: ["custom javascript for websites"] },
    { label: "Stylus", tokens: ["stylus"] },
    { label: "Stylebot", tokens: ["stylebot"] },
    { label: "Resource Override", tokens: ["resource override"] },
];

const SECURITY_ALERT_REASON = {
    DEVTOOLS_SHORTCUT: 1,
    VIEW_SOURCE_SHORTCUT: 2,
    DEVTOOLS_OPENED: 3,
};

const DEVTOOLS_GAP_THRESHOLD = 220;
const DEVTOOLS_OPEN_STREAK_REQUIRED = 2;
const VIEWPORT_CHANGE_COOLDOWN_MS = 1800;

const EXTENSION_SCHEME_MARKERS = [
    "chrome-extension://",
    "moz-extension://",
    "safari-web-extension://",
    "edge-extension://",
];

const INJECTED_SCRIPT_MARKERS = [
    "injected-web.js",
    "injected.js",
];

function hasKnownEditingExtensionToken(text) {
    return KNOWN_GAME_EDITING_EXTENSIONS.some((ext) => ext.tokens.some((token) => text.includes(token)));
}

function resolveStrictClientSecurityGuards() {
    // Disabled by default to avoid false-positive session blocks
    // when browser/devtools shortcuts are triggered.
    return false;
}

export default class NetworkManager {
    constructor (serverAddress, core) {
        this.network = new Network(serverAddress);
        this.isDev = this.network.isDev;
        this.core = core;
        this.setupEventListeners();

        // Initialize bandwidth metrics
        this.startTime = performance.now();
        this.dataReceived = 0;

        // Initialize resource update timeout
        this.lastPing = null;

        // Initialize login status and user data
        this.loggedIn = false;
        this.userData = null;
        this._getUserDataPromise = null;
        this._statsSyncIntervalId = null;
        this._statsSyncInFlight = false;
        this._statsSyncTick = 0;
        this._statsSyncEnabled = false;
        this._lastSyncedStatsSignature = "";
        this._logoutInProgress = false;
        this._lastPlaytimeTickAt = Date.now();
        this.spawnLeaveWatchers = new Map(); // playerID -> playerName
        this.discordInviteUrl = "https://discord.gg/Q337spAqR7";
        this.discordOnboardingSeenKey = "warhex_discord_onboarding_seen_v1";
        this.ownerEmail = "";
        this.ownerEmails = [];
        this.ownerNamePrefix = "OWNER_";
        this.ownerAccountActive = false;
        this.pendingUnauthorizedJoinBlockNotice = false;
        this.securityViolationReported = false;
        this.securityViolationReason = 0;
        this.securityGuardBound = false;
        this.devtoolsOpenStreak = 0;
        this.devtoolsDetectorTimer = null;
        this.lastSecurityViewportChangeAt = 0;
        this.extensionWatchdogTimer = null;
        this.unauthorizedExtensionDetected = false;
        this.enforceStrictClientSecurity = resolveStrictClientSecurityGuards();

        // Use async initialization for login status
        // this.initialize();

        this._bindUnloadStatsSync();
        this._startStatsAutoSync();

        // Monitor bandwidth every second
        this.monitorBandwidth();
        this.setupClientSecurityGuards();
        this.setupUserScriptErrorTrap();
        this.setupUnauthorizedExtensionWatchdog();
    }

    containsUnauthorizedExtensionMarkers(value) {
        const lower = String(value || "").toLowerCase();
        if (!lower) return false;
        if (lower.includes(".user.js")) return true;
        if (INJECTED_SCRIPT_MARKERS.some((marker) => lower.includes(marker))) return true;
        return hasKnownEditingExtensionToken(lower);
    }

    setupUserScriptErrorTrap() {
        if (!this.enforceStrictClientSecurity || typeof window === "undefined") {
            return;
        }

        const inspectRuntimeError = (source) => {
            const text = String(source || "");
            if (!this.containsUnauthorizedExtensionMarkers(text)) {
                return;
            }
            this.handleUnauthorizedExtensionDetected({
                blocked: true,
                detectedExtensions: ["UserScript/Extension runtime"],
                userScriptSources: [text],
            });
        };

        window.addEventListener("error", (event) => {
            const filename = event?.filename || "";
            const message = event?.message || "";
            const stack = event?.error?.stack || "";
            inspectRuntimeError(`${filename}\n${message}\n${stack}`);
        }, true);

        window.addEventListener("unhandledrejection", (event) => {
            const reason = event?.reason;
            const text = typeof reason === "string"
                ? reason
                : `${reason?.message || ""}\n${reason?.stack || ""}`;
            inspectRuntimeError(text);
        }, true);
    }

    setupUnauthorizedExtensionWatchdog() {
        if (!this.enforceStrictClientSecurity || typeof window === "undefined") {
            return;
        }
        if (this.extensionWatchdogTimer) {
            clearInterval(this.extensionWatchdogTimer);
        }

        const evaluate = () => {
            if (this.securityViolationReported || this.unauthorizedExtensionDetected) {
                return;
            }
            const scan = this.scanJoinEnvironmentForUnauthorizedExtensions();
            if (scan.blocked) {
                this.handleUnauthorizedExtensionDetected(scan);
            }
        };

        evaluate();
        this.extensionWatchdogTimer = window.setInterval(evaluate, 2200);
    }

    handleUnauthorizedExtensionDetected(scan) {
        if (this.unauthorizedExtensionDetected) {
            return;
        }
        this.unauthorizedExtensionDetected = true;
        this.pendingUnauthorizedJoinBlockNotice = true;
        this.showUnauthorizedExtensionBlock(scan);

        try {
            const msg = Message.createClientSecurityAlertMessage(SECURITY_ALERT_REASON.DEVTOOLS_OPENED);
            this.sendMessage(msg);
        } catch (error) {}

        this.securityViolationReported = true;
        this.securityViolationReason = SECURITY_ALERT_REASON.DEVTOOLS_OPENED;
        try {
            this.network?.worker?.postMessage?.({ type: "disconnect" });
        } catch (error) {}
    }

    _bindUnloadStatsSync () {
        const flush = () => {
            if (!this.loggedIn || !this.userId || !this.userData) return;
            const statistics = this.userData.statistics || {
                highscore: Number(this.userData.highscore || 0),
                kills: Number(this.userData.total_kills || this.userData.kills || 0),
                playtime: Number(this.userData.playtime || 0)
            };

            // Keep local cache in sync first
            try {
                const minimal = {
                    id: this.userData.id || this.userId,
                    email: this.getCurrentKnownEmail() || null,
                    nickname: this.userData.nickname,
                    role: this.userData.role || "user",
                    skins: this.userData.skins || {},
                    progression: this.userData.progression || { level: 1, xp: 0 },
                    statistics,
                    highscore: statistics.highscore,
                    total_kills: statistics.kills,
                    playtime: statistics.playtime
                };
                localStorage.setItem("blobl_user_data", JSON.stringify(minimal));
            } catch (e) {}

            // Best-effort remote flush on reload/close.
            const progression = this.userData.progression || {
                level: Number(this.userData.level || 1),
                xp: Number(this.userData.xp || 0)
            };
            if (this._statsSyncEnabled) {
                updateUserProgressStatsKeepalive(this.userId, statistics, progression);
            }
        };

        window.addEventListener("pagehide", flush);
        window.addEventListener("beforeunload", flush);
    }

    _startStatsAutoSync () {
        if (this._statsSyncIntervalId) {
            clearInterval(this._statsSyncIntervalId);
        }

        this._statsSyncIntervalId = setInterval(() => {
            this._runStatsSyncFiveStep();
        }, 1500);
    }

    _buildStatsSignature (statistics = {}) {
        return JSON.stringify({
            h: Math.max(0, Number(statistics?.highscore || 0)),
            k: Math.max(0, Number(statistics?.kills || 0)),
            p: Math.max(0, Number(statistics?.playtime || 0))
        });
    }

    async _runStatsSyncFiveStep () {
        // Step 1: authentication gate
        if (!this.loggedIn || !this.userId) return;
        // Step 2: data availability gate
        if (!this.userData) return;
        // Prevent stale local cache from overwriting server stats before real hydration.
        if (!this._statsSyncEnabled) return;

        if (this._statsSyncInFlight) return;
        this._statsSyncInFlight = true;

        try {
            this._captureLiveSessionStats();
            // Step 3: normalize/sanitize stats payload
            const progression = this.userData.progression || {
                level: Number(this.userData.level || 1),
                xp: Number(this.userData.xp || 0)
            };
            const statistics = this.userData.statistics || {
                highscore: Number(this.userData.highscore || 0),
                kills: Number(this.userData.total_kills || this.userData.kills || 0),
                playtime: Number(this.userData.playtime || 0)
            };
            statistics.highscore = Math.max(0, Number(statistics.highscore || 0));
            statistics.kills = Math.max(0, Number(statistics.kills || 0));
            statistics.playtime = Math.max(0, Number(statistics.playtime || 0));

            const statsSignature = this._buildStatsSignature(statistics);
            if (statsSignature === this._lastSyncedStatsSignature) {
                return;
            }

            // Step 4: persist local snapshot for immediate F5 recovery
            try {
                const minimal = {
                    id: this.userData.id || this.userId,
                    email: this.getCurrentKnownEmail() || null,
                    nickname: this.userData.nickname,
                    role: this.userData.role || "user",
                    skins: this.userData.skins || {},
                    progression,
                    statistics,
                    highscore: statistics.highscore,
                    total_kills: statistics.kills,
                    playtime: statistics.playtime,
                    level: progression.level,
                    xp: progression.xp
                };
                localStorage.setItem("blobl_user_data", JSON.stringify(minimal));
            } catch (e) {
                console.warn("Stats auto-sync local write failed:", e);
            }

            // Step 5: persist remote snapshot with retries
            let synced = false;
            let lastError = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
                const result = await updateUserProgressStats(this.userId, progression, statistics);
                if (result?.success) {
                    synced = true;
                    break;
                }
                lastError = result?.error || lastError;
            }

            this._statsSyncTick++;
            if (!synced) {
                console.warn("Stats auto-sync remote failed after 3 attempts.", lastError);
            } else {
                this._lastSyncedStatsSignature = statsSignature;
                invalidateGlobalLeaderboardCache();
                if (!this.core?.gameManager?.player && typeof this.core?.uiManager?._populateGlobalLeaderboard === "function") {
                    this.core.uiManager._populateGlobalLeaderboard();
                }
                if (this._statsSyncTick % 10 === 0) {
                    console.log("Stats auto-sync OK.");
                }
            }
        } finally {
            this._statsSyncInFlight = false;
        }
    }

    _captureLiveSessionStats () {
        if (!this.userData) return;

        const statistics = this.userData.statistics || {
            highscore: Number(this.userData.highscore || 0),
            kills: Number(this.userData.total_kills || this.userData.kills || 0),
            playtime: Number(this.userData.playtime || 0)
        };

        const now = Date.now();
        const isInMatch = Boolean(this.core?.gameManager?.player);

        if (isInMatch) {
            if (!this._lastPlaytimeTickAt) {
                this._lastPlaytimeTickAt = now;
            }
            const elapsedSeconds = Math.floor((now - this._lastPlaytimeTickAt) / 1000);
            if (elapsedSeconds > 0) {
                statistics.playtime = Math.max(0, Number(statistics.playtime || 0)) + elapsedSeconds;
                this._lastPlaytimeTickAt += elapsedSeconds * 1000;
            }
        } else {
            this._lastPlaytimeTickAt = now;
        }

        const liveScore = Number(this.core?.leaderboard?.getCurrentPlayerScore?.() || 0);
        if (Number.isFinite(liveScore) && liveScore > Number(statistics.highscore || 0)) {
            statistics.highscore = liveScore;
        }

        statistics.highscore = Math.max(0, Number(statistics.highscore || 0));
        statistics.kills = Math.max(0, Number(statistics.kills || 0));
        statistics.playtime = Math.max(0, Number(statistics.playtime || 0));

        this.userData.statistics = statistics;
        this.userData.highscore = statistics.highscore;
        this.userData.total_kills = statistics.kills;
        this.userData.playtime = statistics.playtime;
    }

    normalizeEmail (value = "") {
        return String(value || "").trim().toLowerCase();
    }

    isOwnerEmail (email = "") {
        return false;
    }

    extractEmailFromAuthUser (authUser = null) {
        const user = authUser || {};
        const directEmail = user?.email || user?.user_metadata?.email || user?.raw_user_meta_data?.email || "";
        if (directEmail) return String(directEmail).trim();

        const identities = Array.isArray(user?.identities) ? user.identities : [];
        for (const identity of identities) {
            const providerEmail = identity?.email || identity?.identity_data?.email || "";
            if (providerEmail) return String(providerEmail).trim();
        }
        return "";
    }

    isOwnerRole (role = "") {
        const value = String(role || "").trim().toLowerCase();
        return value === "owner" || value === "admin" || value === "adm" || value === "dono";
    }

    getStoredSessionEmail () {
        try {
            const rawSession = localStorage.getItem("blobl_supabase_session");
            if (!rawSession) return "";
            const session = JSON.parse(rawSession);
            return this.extractEmailFromAuthUser(session?.user || {});
        } catch (e) {
            return "";
        }
    }

    getStoredUserEmail () {
        try {
            const rawUser = localStorage.getItem("blobl_user_data");
            if (!rawUser) return "";
            const user = JSON.parse(rawUser);
            return user?.email || "";
        } catch (e) {
            return "";
        }
    }

    getCurrentKnownEmail () {
        return this.userData?.email || this.getStoredSessionEmail() || this.getStoredUserEmail() || "";
    }

    isOwnerAccount () {
        if (this.ownerAccountActive) return true;
        if (this.isOwnerRole(this.userData?.role)) return true;
        return false;
    }

    isOwnerDisplayName (name = "") {
        const prefix = String(this.ownerNamePrefix || "OWNER_").toLowerCase();
        return String(name || "").toLowerCase().startsWith(prefix);
    }

    trimNameToProtocolLimit (name = "") {
        let value = String(name || "")
            .replace(/[\u0000-\u001F\u007F]/g, "")
            .trim();
        if (!value) return "";

        const encoder = new TextEncoder();
        const chars = Array.from(value);
        while (chars.length > 0 && encoder.encode(chars.join("")).length > 12) {
            chars.pop();
        }
        return chars.join("");
    }

    applyOwnerTagToName (name = "") {
        const base = this.trimNameToProtocolLimit(name);
        if (!this.isOwnerAccount()) return base;

        const prefix = this.ownerNamePrefix || "OWNER_";
        const lowerBase = String(base || "");
        const normalizedBase = lowerBase.toLowerCase().startsWith(prefix.toLowerCase())
            ? lowerBase.slice(prefix.length)
            : lowerBase;
        const tagged = `${prefix}${normalizedBase || "OWNER"}`;
        return this.trimNameToProtocolLimit(tagged);
    }

    async ensureOwnerRolePersisted () {
        return;
    }

    async hydrateAuthenticatedSession (session) {
        const sessionUser = session?.user;
        if (!sessionUser?.id) return;

        let authUser = sessionUser;
        try {
            const freshAuthUser = await getCurrentUser();
            if (freshAuthUser?.id === sessionUser.id) {
                authUser = freshAuthUser;
            }
        } catch (e) {}

        this.loggedIn = true;
        this.userId = sessionUser.id;
        this._statsSyncEnabled = false;
        this._lastSyncedStatsSignature = "";
        this.ownerAccountActive = this.isOwnerRole(this.userData?.role);

        try {
            const preferredNickname = this.userData?.nickname || authUser?.user_metadata?.nickname || "";
            await ensureUserRow(authUser, preferredNickname);
        } catch (error) {
            console.warn("Failed to ensure user row during auth session hydration:", error);
        }

        await this.getUserData();
    }

    async initialize () {
        // Listen for auth state changes
        onAuthStateChange(async (event, session) => {
            const authEvent = String(event || "");
            const isAuthenticatedEvent = authEvent === "SIGNED_IN" || authEvent === "INITIAL_SESSION";
            if (isAuthenticatedEvent && session?.user) {
                await this.hydrateAuthenticatedSession(session);
                this.core.uiManager.updateAccountButton();
            } else if (event === 'SIGNED_OUT') {
                this.loggedIn = false;
                this.userId = null;
                this.userData = null;
                this._statsSyncEnabled = false;
                this._lastSyncedStatsSignature = "";
                this.ownerAccountActive = false;
                this.core.uiManager.updateAccount();
                this.core.uiManager.updateAccountButton();
            }
        });

        await this.checkLoginStatus();

        if (this.loggedIn) {
            await this.getUserData();
        }
    }

    async getUserData () {
        if (this._getUserDataPromise) {
            return this._getUserDataPromise;
        }

        this._getUserDataPromise = (async () => {
        console.log('getUserData called');
        // In dev mode, still attempt to fetch real user data when logged in.
        // Only use the dev fallback when not logged in.
        if (this.isDev && !this.loggedIn) {
            this.userData = { skins: { unlocked: [0], equipped: 0 } };
            this.core.uiManager.updateAccount();
            return;
        }
        if (!this.userId) {
            console.warn("getUserData called without userId");
            return;
        }
        this._statsSyncEnabled = false;
        try {
            // Fast primary path: REST fetch (usually faster/more stable than SDK select here).
            const restPrimary = await fetchUserRowById(this.userId).catch(() => ({ success: false, data: null }));
            if (restPrimary?.success && restPrimary?.data) {
                this.userData = restPrimary.data;
                this.userData.statistics = {
                    ...(this.userData.statistics || {}),
                    highscore: Number(this.userData.highscore ?? this.userData.statistics?.highscore ?? 0),
                    kills: Number(this.userData.total_kills ?? this.userData.statistics?.kills ?? 0),
                    playtime: Number(this.userData.playtime ?? this.userData.statistics?.playtime ?? 0)
                };
                this.userData.progression = {
                    ...(this.userData.progression || {}),
                    level: Number(this.userData.level ?? this.userData.progression?.level ?? 1),
                    xp: Number(this.userData.xp ?? this.userData.progression?.xp ?? 0)
                };
                this._statsSyncEnabled = true;
                try {
                    const minimal = {
                        id: this.userData.id,
                        email: this.userData.email || this.getCurrentKnownEmail() || null,
                        nickname: this.userData.nickname,
                        role: this.userData.role || "user",
                        skins: this.userData.skins || {},
                        progression: this.userData.progression,
                        statistics: this.userData.statistics,
                        highscore: this.userData.statistics.highscore,
                        total_kills: this.userData.statistics.kills,
                        playtime: this.userData.statistics.playtime,
                        level: this.userData.progression.level,
                        xp: this.userData.progression.xp
                    };
                    localStorage.setItem('blobl_user_data', JSON.stringify(minimal));
                } catch (e) {}

                const user = await getCurrentUser().catch(() => null);
                if (user && !this.userData.email) {
                    this.userData.email = this.extractEmailFromAuthUser(user) || null;
                }
                if (user && user.user_metadata && user.user_metadata.nickname && !this.userData.nickname) {
                    this.userData.nickname = user.user_metadata.nickname;
                }
                if (!this.userData?.nickname) {
                    this.userData.nickname = this.extractEmailFromAuthUser(user).split("@")[0] || "Player";
                }
                this.ownerAccountActive = this.isOwnerEmail(this.getCurrentKnownEmail()) || this.isOwnerRole(this.userData?.role);
                await this.ensureOwnerRolePersisted();
                this._lastSyncedStatsSignature = this._buildStatsSignature(this.userData.statistics);
                this.core.uiManager.updateAccount();
                return;
            }

            console.log('Starting supabase select for id:', this.userId);
            const selectPromise = supabase
                .from('users')
                .select('*')
                .eq('id', this.userId)
                .maybeSingle();

            // Timeout helper with one retry before local fallback.
            const runWithTimeout = async (promise, timeoutMs) => {
                const timeoutToken = Symbol("supabase_timeout");
                const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(timeoutToken), timeoutMs));
                const result = await Promise.race([promise, timeoutPromise]);
                return { timedOut: result === timeoutToken, result };
            };

            const firstTry = await runWithTimeout(selectPromise, 6000);
            let raceResult = firstTry.result;

            if (firstTry.timedOut) {
                console.warn("Supabase select timed out after 6000ms. Retrying once...");
                const secondSelectPromise = supabase
                    .from('users')
                    .select('*')
                    .eq('id', this.userId)
                    .maybeSingle();

                const secondTry = await runWithTimeout(secondSelectPromise, 4000);
                raceResult = secondTry.result;

                if (secondTry.timedOut) {
                    console.warn("Supabase select timed out again after 4000ms; trying REST fallback before local cache.");

                const restFallback = await fetchUserRowById(this.userId).catch(() => ({ success: false, data: null }));
                if (restFallback?.success && restFallback?.data) {
                    this.userData = restFallback.data;
                    this.userData.statistics = {
                        ...(this.userData.statistics || {}),
                        highscore: Number(this.userData.highscore ?? this.userData.statistics?.highscore ?? 0),
                        kills: Number(this.userData.total_kills ?? this.userData.statistics?.kills ?? 0),
                        playtime: Number(this.userData.playtime ?? this.userData.statistics?.playtime ?? 0)
                    };
                    this.userData.progression = {
                        ...(this.userData.progression || {}),
                        level: Number(this.userData.level ?? this.userData.progression?.level ?? 1),
                        xp: Number(this.userData.xp ?? this.userData.progression?.xp ?? 0)
                    };
                    this.loggedIn = true;
                    this._statsSyncEnabled = true;
                    this._lastSyncedStatsSignature = "";
                    this.ownerAccountActive = this.isOwnerEmail(this.getCurrentKnownEmail()) || this.isOwnerRole(this.userData?.role);
                    this.core.uiManager.updateAccountButton();
                    this.core.uiManager.updateAccount();
                    return;
                }

                console.warn("REST fallback also failed; using cached/local data fallback.");

                const user = await getCurrentUser();
                const fallbackNickname = user?.user_metadata?.nickname || user?.email?.split("@")[0] || "Player";
                this.userData = {
                    ...(this.userData || {}),
                    id: this.userId,
                    email: this.extractEmailFromAuthUser(user) || null,
                    nickname: this.userData?.nickname || fallbackNickname
                };
                this.userData.statistics = {
                    ...(this.userData.statistics || {}),
                    highscore: Math.max(0, Number(this.userData.highscore ?? this.userData.statistics?.highscore ?? 0)),
                    kills: Math.max(0, Number(this.userData.total_kills ?? this.userData.statistics?.kills ?? 0)),
                    playtime: Math.max(0, Number(this.userData.playtime ?? this.userData.statistics?.playtime ?? 0))
                };
                this.userData.progression = {
                    ...(this.userData.progression || {}),
                    level: Math.max(1, Number(this.userData.level ?? this.userData.progression?.level ?? 1)),
                    xp: Math.max(0, Number(this.userData.xp ?? this.userData.progression?.xp ?? 0))
                };
                this.ownerAccountActive = this.isOwnerEmail(this.userData?.email || this.extractEmailFromAuthUser(user)) || this.isOwnerRole(this.userData?.role);
                this.loggedIn = true;
                this._statsSyncEnabled = true;
                // Fallback path can be based on stale local/auth cache; force first remote sync.
                this._lastSyncedStatsSignature = "";
                this.core.uiManager.updateAccountButton();
                this.core.uiManager.updateAccount();
                return;
                }
            }

            const res = raceResult;

            console.log('Supabase response for users select:', res);

            const { data, error } = res;
            if (error) {
                console.error('Error from supabase select:', error);
                throw error;
            }

            const row = Array.isArray(data) ? data[0] : data;
            if (row) {
                this.userData = row;
                this.userData.statistics = {
                    ...(this.userData.statistics || {}),
                    highscore: Number(this.userData.highscore ?? this.userData.statistics?.highscore ?? 0),
                    kills: Number(this.userData.total_kills ?? this.userData.statistics?.kills ?? 0),
                    playtime: Number(this.userData.playtime ?? this.userData.statistics?.playtime ?? 0)
                };
                this.userData.progression = {
                    ...(this.userData.progression || {}),
                    level: Number(this.userData.level ?? this.userData.progression?.level ?? 1),
                    xp: Number(this.userData.xp ?? this.userData.progression?.xp ?? 0)
                };
                console.log('User data from table:', this.userData);
                console.log('Nickname from table:', this.userData?.nickname);
                this._statsSyncEnabled = true;
                try {
                    // persist minimal userData for instant restore on reload
                    const minimal = {
                        id: this.userData.id,
                        email: this.userData.email || this.getCurrentKnownEmail() || null,
                        nickname: this.userData.nickname,
                        role: this.userData.role || "user",
                        skins: this.userData.skins || {},
                        progression: this.userData.progression,
                        statistics: this.userData.statistics,
                        highscore: this.userData.statistics.highscore,
                        total_kills: this.userData.statistics.kills,
                        playtime: this.userData.statistics.playtime,
                        level: this.userData.progression.level,
                        xp: this.userData.progression.xp
                    };
                    localStorage.setItem('blobl_user_data', JSON.stringify(minimal));
                } catch (e) {
                    console.warn('Could not persist userData to localStorage:', e);
                }
            } else {
                console.log('No user data found in table for id:', this.userId);
                this.userData = null;
                try {
                    const authUser = await getCurrentUser();
                    if (authUser?.id) {
                        const ensured = await ensureUserRow(authUser, authUser?.user_metadata?.nickname || "");
                        if (ensured?.success && ensured?.data) {
                            this.userData = ensured.data;
                            this._statsSyncEnabled = true;
                            this.ownerAccountActive = this.isOwnerEmail(this.userData?.email || this.extractEmailFromAuthUser(authUser)) || this.isOwnerRole(this.userData?.role);
                        } else {
                            const { data: retryData, error: retryError } = await supabase
                                .from('users')
                                .select('*')
                                .eq('id', this.userId)
                                .maybeSingle();
                            if (!retryError && retryData) {
                                this.userData = retryData;
                                this._statsSyncEnabled = true;
                                this.ownerAccountActive = this.isOwnerEmail(this.userData?.email || this.extractEmailFromAuthUser(authUser)) || this.isOwnerRole(this.userData?.role);
                            }
                        }
                    }
                } catch (ensureError) {
                    console.warn('Could not ensure missing user row after OAuth/login:', ensureError);
                }
            }
            // Get nickname from auth metadata if not in table
            const user = await getCurrentUser();
            if (user) {
                if (!this.userData) {
                    this.userData = {};
                }
                if (!this.userData.email) {
                    this.userData.email = this.extractEmailFromAuthUser(user) || null;
                }
            }
            if (user && user.user_metadata && user.user_metadata.nickname) {
                if (!this.userData) {
                    this.userData = {};
                }
                if (!this.userData.nickname) {
                    this.userData.nickname = user.user_metadata.nickname;
                    console.log('Using nickname from auth metadata:', this.userData.nickname);
                }
            }
            if (user && !this.userData?.nickname) {
                this.userData.nickname = this.extractEmailFromAuthUser(user).split("@")[0] || "Player";
            }
            this.ownerAccountActive = this.isOwnerEmail(this.getCurrentKnownEmail()) || this.isOwnerRole(this.userData?.role);
            await this.ensureOwnerRolePersisted();
            if (this.userData) {
                if (this.userData.statistics) {
                    this._lastSyncedStatsSignature = this._buildStatsSignature(this.userData.statistics);
                }
                // Ensure skins and unlocked properties exist before accessing them
                const equippedSkin = Number(localStorage.getItem("equippedSkin")) || 0;
                if (this.userData.skins && Array.isArray(this.userData.skins.unlocked) && this.userData.skins.unlocked.includes(equippedSkin)) {
                    this.userData.skins.equipped = equippedSkin;
                }
            }
            this.core.uiManager.updateAccount();

        } catch (error) {
            console.error("Error getting user data:", error);
            try {
                const user = await getCurrentUser();
                if (user && this.userId) {
                    const fallbackNickname = user.user_metadata?.nickname || this.extractEmailFromAuthUser(user).split("@")[0] || "Player";
                    this.loggedIn = true;
                    this.userData = {
                        ...(this.userData || {}),
                        id: this.userId,
                        email: this.extractEmailFromAuthUser(user) || null,
                        nickname: this.userData?.nickname || fallbackNickname,
                        statistics: this.userData?.statistics || { highscore: 0, playtime: 0, kills: 0 },
                        progression: this.userData?.progression || { level: 1, xp: 0 }
                    };
                this.ownerAccountActive = this.isOwnerEmail(this.userData?.email || this.extractEmailFromAuthUser(user)) || this.isOwnerRole(this.userData?.role);
                this.userData.statistics = {
                    ...(this.userData.statistics || {}),
                    highscore: Math.max(0, Number(this.userData.highscore ?? this.userData.statistics?.highscore ?? 0)),
                    kills: Math.max(0, Number(this.userData.total_kills ?? this.userData.statistics?.kills ?? 0)),
                    playtime: Math.max(0, Number(this.userData.playtime ?? this.userData.statistics?.playtime ?? 0))
                };
                this.userData.progression = {
                    ...(this.userData.progression || {}),
                    level: Math.max(1, Number(this.userData.level ?? this.userData.progression?.level ?? 1)),
                    xp: Math.max(0, Number(this.userData.xp ?? this.userData.progression?.xp ?? 0))
                };
                this._statsSyncEnabled = true;
                // Error fallback may not reflect DB state; force one remote reconciliation sync.
                this._lastSyncedStatsSignature = "";
                this.core.uiManager.updateAccountButton();
                this.core.uiManager.updateAccount();
            }
        } catch (fallbackErr) {
            console.error("Fallback user recovery failed:", fallbackErr);
        }
        }
        })();

        try {
            return await this._getUserDataPromise;
        } finally {
            this._getUserDataPromise = null;
        }
    }

    async checkLoginStatus () {
        try {
            try {
                const oauthResult = await consumeOAuthCallbackSession();
                if (oauthResult?.error) {
                    console.error("OAuth callback processing error:", oauthResult.error);
                }
                if (oauthResult?.session?.user?.id) {
                    await this.hydrateAuthenticatedSession(oauthResult.session);
                    this.core.uiManager.updateAccountButton();
                    return;
                }
            } catch (oauthError) {
                console.error("Failed to process OAuth callback:", oauthError);
            }

            // Fast-path: use persisted session and userData for instant UI
            try {
                const rawSession = localStorage.getItem('blobl_supabase_session');
                const rawUser = localStorage.getItem('blobl_user_data');
                if (rawSession) {
                    try {
                        const sess = JSON.parse(rawSession);
                        if (sess && sess.user && sess.user.id) {
                            this.loggedIn = true;
                            this.userId = sess.user.id;
                            this._statsSyncEnabled = false;
                            this.ownerAccountActive = this.isOwnerEmail(this.extractEmailFromAuthUser(sess.user)) || this.isOwnerRole(this.userData?.role);
                            console.log('Restored session quick (local):', this.userId);
                            if (rawUser) {
                                try {
                                    this.userData = JSON.parse(rawUser);
                                    if (!this.userData?.email) {
                                        this.userData = {
                                            ...(this.userData || {}),
                                            email: this.extractEmailFromAuthUser(sess.user) || null
                                        };
                                    }
                                    this.userData.statistics = {
                                        ...(this.userData.statistics || {}),
                                        highscore: Number(this.userData.highscore ?? this.userData.statistics?.highscore ?? 0),
                                        kills: Number(this.userData.total_kills ?? this.userData.statistics?.kills ?? 0),
                                        playtime: Number(this.userData.playtime ?? this.userData.statistics?.playtime ?? 0)
                                    };
                                    this.userData.progression = {
                                        ...(this.userData.progression || {}),
                                        level: Number(this.userData.level ?? this.userData.progression?.level ?? 1),
                                        xp: Number(this.userData.xp ?? this.userData.progression?.xp ?? 0)
                                    };
                                    if (!this.userData.nickname) {
                                        this.userData.nickname = sess.user.user_metadata?.nickname || this.extractEmailFromAuthUser(sess.user).split("@")[0] || "Player";
                                    }
                                    this.ownerAccountActive = this.isOwnerEmail(this.getCurrentKnownEmail()) || this.isOwnerRole(this.userData?.role);
                                    // Local restore is only a visual fast-path; keep signature empty so DB sync runs.
                                    this._lastSyncedStatsSignature = "";
                                    console.log('Restored userData quick (local):', this.userData);
                                    this.core.uiManager.updateAccount();
                                } catch (e) {
                                    console.warn('Failed to parse local userData:', e);
                                }
                            }
                            // Kick off background restore + fetch but don't await here
                            (async () => {
                                try {
                                    const restored = await restoreSessionFromStorage();
                                    if (restored && restored.user && restored.user.id) {
                                        if (!this.loggedIn || this.userId !== restored.user.id) {
                                            this.loggedIn = true;
                                            this.userId = restored.user.id;
                                        }
                                        await this.hydrateAuthenticatedSession(restored);
                                    } else {
                                        // Validate live auth state; if no real session exists,
                                        // clear stale local login so UI and publish permissions stay consistent.
                                        const { data: liveSessionData } = await supabase.auth.getSession();
                                        const liveSession = liveSessionData?.session || null;
                                        if (liveSession?.user?.id) {
                                            await this.hydrateAuthenticatedSession(liveSession);
                                        } else {
                                            const liveAuthUser = await getCurrentUser().catch(() => null);
                                            if (liveAuthUser?.id) {
                                                await this.hydrateAuthenticatedSession({ user: liveAuthUser });
                                            } else {
                                                this.loggedIn = false;
                                                this.userId = null;
                                                this.userData = null;
                                                this._statsSyncEnabled = false;
                                                this._lastSyncedStatsSignature = "";
                                                this.ownerAccountActive = false;
                                                clearLocalAuthState();
                                                try { localStorage.removeItem('blobl_user_data'); } catch (e) {}
                                                this.core.uiManager.updateAccount();
                                                this.core.uiManager.updateAccountButton();
                                            }
                                        }
                                    }
                                } catch (e) {
                                    console.warn('Background restore failed:', e);
                                }
                            })();
                            // fast-path done
                            this.core.uiManager.updateAccountButton();
                            return;
                        }
                    } catch (e) {
                        console.warn('Failed parsing local session:', e);
                    }
                }

                // Fallback: normal getSession flow if no local session
                const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
                if (sessionError) console.error('Error getting supabase session:', sessionError);
                const session = sessionData?.session || null;
                console.log('Supabase session on checkLoginStatus:', session);
                if (session && session.user) {
                    await this.hydrateAuthenticatedSession(session);
                } else {
                    this.loggedIn = false;
                    this.userId = null;
                    this.userData = null;
                    this._statsSyncEnabled = false;
                    this._lastSyncedStatsSignature = "";
                    this.ownerAccountActive = false;
                }
            } catch (e) {
                console.error('Error during checkLoginStatus flow:', e);
                this.loggedIn = false;
                this.userId = null;
                this.userData = null;
                this._statsSyncEnabled = false;
                this._lastSyncedStatsSignature = "";
                this.ownerAccountActive = false;
            }
        } catch (error) {
            console.error("Error checking login status:", error);
            this.loggedIn = false;
            this.userId = null;
            this._statsSyncEnabled = false;
            this._lastSyncedStatsSignature = "";
            this.ownerAccountActive = false;
        }
        this.core.uiManager.updateAccountButton();
    }

    async logout () {
        if (this._logoutInProgress) return;
        this._logoutInProgress = true;
        try {
            await Promise.race([
                signOut(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("logout_timeout")), 2500))
            ]);
        } catch (error) {
            console.error("Error during logout:", error);
        } finally {
            // Always clear local auth/UI state even if remote signOut fails.
            this.loggedIn = false;
            this.userId = null;
            this.userData = null;
            this._statsSyncEnabled = false;
            this._lastSyncedStatsSignature = "";
            this.ownerAccountActive = false;
            clearLocalAuthState();
            try { localStorage.removeItem('blobl_user_data'); } catch (e) {}
            this.core.uiManager.updateAccount();
            this.core.uiManager.updateAccountButton();
            this._logoutInProgress = false;
            window.location.reload();
        }
    }

    async updateUserData (data) {
        if (this.isDev) {
            // In dev mode, just update locally
            this.userData = { ...this.userData, ...data };
            this.core.uiManager.updateAccount();
            return;
        }
        try {
            const { error } = await supabase
                .from('users')
                .update(data)
                .eq('id', this.userId);

            if (error) throw error;

            // Update local userData
            this.userData = { ...this.userData, ...data };
            try {
                const minimal = {
                    id: this.userData.id,
                    email: this.getCurrentKnownEmail() || null,
                    nickname: this.userData.nickname,
                    role: this.userData.role || "user",
                    skins: this.userData.skins || {},
                    progression: this.userData.progression || { level: 1, xp: 0 },
                    statistics: this.userData.statistics || { highscore: 0, playtime: 0, kills: 0 },
                    highscore: Number(this.userData.highscore ?? this.userData.statistics?.highscore ?? 0),
                    total_kills: Number(this.userData.total_kills ?? this.userData.statistics?.kills ?? 0),
                    playtime: Number(this.userData.playtime ?? this.userData.statistics?.playtime ?? 0),
                    level: Number(this.userData.level ?? this.userData.progression?.level ?? 1),
                    xp: Number(this.userData.xp ?? this.userData.progression?.xp ?? 0)
                };
                localStorage.setItem('blobl_user_data', JSON.stringify(minimal));
            } catch (e) {}
            this.core.uiManager.updateAccount();

        } catch (error) {
            console.error("Error updating user data:", error);
        }
    }

    monitorBandwidth () {
        setInterval(() => {
            const currentTime = performance.now();
            const elapsedTime = (currentTime - this.startTime) / 1000; // in seconds
            this.startTime = currentTime;

            const bandwidthReceived = this.dataReceived / elapsedTime; // bytes per second
            const bandwidthSent = this.dataSent / elapsedTime; // bytes per second

            // Convert to kilobytes per second and megabytes per second
            const bandwidthReceivedKBps = bandwidthReceived / 1024;
            const bandwidthReceivedMBps = bandwidthReceivedKBps / 1024;
            const bandwidthSentKBps = bandwidthSent / 1024;
            const bandwidthSentMBps = bandwidthSentKBps / 1024;

            // Determine whether to display in bytes, kilobytes, or megabytes
            const bandwidthReceivedDisplay = bandwidthReceivedMBps > 1
                ? `${bandwidthReceivedMBps.toFixed(2)} MBps`
                : (bandwidthReceivedKBps > 1
                    ? `${bandwidthReceivedKBps.toFixed(2)} KBps`
                    : `${bandwidthReceived.toFixed(0)} Bps`);
            const bandwidthSentDisplay = bandwidthSentMBps > 1
                ? `${bandwidthSentMBps.toFixed(2)} MBps`
                : (bandwidthSentKBps > 1
                    ? `${bandwidthSentKBps.toFixed(2)} KBps`
                    : `${bandwidthSent.toFixed(0)} Bps`);

            // Update metrics
            this.core.gameManager.metrics.bandwidthReceived = bandwidthReceivedDisplay;
            this.core.gameManager.metrics.bandwidthSent = bandwidthSentDisplay;

            // Reset counters for the next interval
            this.dataReceived = 0;
            this.dataSent = 0;

            // Update UI with metrics
            this.core.uiManager.updateMetrics();
        }, 1000); // every 1 second
    }

    connect () {
        this.core.uiManager.showConnectingOverlay(true);
        this.network.connect();
    }

    // Set up event listeners for network events
    setupEventListeners () {
        this.network.addEventListener("open", () => this.handleNetworkOpen());
        this.network.addEventListener("error", (error) => this.handleNetworkError(error));
        this.network.addEventListener("message", (message) => this.handleNetworkMessage(message));
        this.network.addEventListener("close", () => this.handleNetworkClose());
    }

    // Handle successful connection to the server
    handleNetworkOpen () {
        console.log("Connected to server.");
        this.core.uiManager.showConnectingOverlay(false);
        this.core.uiManager.showMenuUIElements(true);
        this.core.uiManager.showGameUIElements(false);
    }

    // Handle network errors
    handleNetworkError (error) {
        console.error("Network error:", error);
        this.core.uiManager.showConnectingOverlay(true);
        this.core.uiManager.showMenuUIElements(true);
        this.core.uiManager.showGameUIElements(false);
        this.core.camera.enableControls(false);
    }

    // Handle network close
    handleNetworkClose () {
        console.log("Disconnected from server.");
        this.core.uiManager.showConnectingOverlay(true);
        this.core.uiManager.showMenuUIElements(true);
        this.core.uiManager.showGameUIElements(false);
        this.core.camera.enableControls(false);
    }

    // Handle messages received from the server
    handleNetworkMessage (message) {
        this.dataReceived += message.bytes; // Track the size of the message received    

        const { type, payload } = message;

        // Reset ping for RESOURCE_UPDATE
        if (type === MessageTypes.RESOURCE_UPDATE) {
            this.resetLastPing();
        }

        // Define a map of message types to their handlers
        const messageHandlers = new Map([
            [MessageTypes.GAME_STATE, () => {
                this.handleGameState(payload);
                this.core.uiManager.showConnectingOverlay(false);
            }],
            [MessageTypes.INITIAL_PLAYER_DATA, () => {
                this.handleInitialPlayerData(payload);
                this.core.gameManager.startProtectionTimer();
                this.core.uiManager.showMenuUIElements(false);
                this.core.uiManager.showGameUIElements(true);
                this.core.camera.enableControls(true);
                this.core.miniMap.minimize();
                this.handleDiscordOnboardingNotice();
            }],
            [MessageTypes.RESOURCE_UPDATE, () => this.handleResourceUpdate(payload)],
            [MessageTypes.UNITS_POSITION_UPDATE, () => this.handleUnitsPositionUpdate(payload)],
            [MessageTypes.UNITS_ROTATION_UPDATE, () => this.handleUnitsRotationUpdate(payload)],
            [MessageTypes.REMOVE_UNIT, () => this.handleRemoveUnit(payload)],
            [MessageTypes.SPAWN_UNIT, () => this.handleSpawnUnit(payload)],
            [MessageTypes.PLAYER_JOINED, () => this.handlePlayerJoined(payload)],
            [MessageTypes.PLAYER_LEFT, () => this.handlePlayerLeft(payload)],
            [MessageTypes.KILLED, () => this.handleKilled(payload)],
            [MessageTypes.KICK_NOTIFICATION, () => this.handleKickNotification(payload)],
            [MessageTypes.BASE_HEALTH_UPDATE, () => this.handleBaseHealthUpdate(payload)],
            [MessageTypes.BUILDING_PLACED, () => this.handleBuildingPlaced(payload)],
            [MessageTypes.BUILDINGS_UPGRADED, () => this.handleBuildingsUpgraded(payload)],
            [MessageTypes.BUILDINGS_REMOVED, () => this.handleBuildingsRemoved(payload)],
            [MessageTypes.BARRACKS_ACTIVATION_UPDATE, () => this.handleBarracksActivationUpdate(payload)],
            [MessageTypes.SPAWN_BULLET, () => this.handleSpawnBullet(payload)],
            [MessageTypes.UNIT_SPAWN_BULLET, () => this.handleUnitSpawnBullet(payload)],
            [MessageTypes.REMOVE_BULLET, () => this.handleRemoveBullet(payload)],
            [MessageTypes.BULLET_POSITION_UPDATE, () => this.handleBulletPositionUpdate(payload)],
            [MessageTypes.LEADERBOARD_UPDATE, () => this.handleLeaderboardUpdate(payload)],
            [MessageTypes.REMOVE_SPAWN_PROTECTION, () => this.handleRemoveSpawnProtection(payload)],
            [MessageTypes.CHAT_MESSAGE, () => this.handleChatMessage(payload)],
            [MessageTypes.BUILDING_PLACEMENT_FAILED, () => this.handleBuildingPlacementFailed(payload)],
            [MessageTypes.INITIAL_BULLET_STATES, () => this.handleInitialBulletStates(payload)],
            [MessageTypes.TURRET_ROTATION_UPDATE, () => this.handleTurretRotationUpdate(payload)],
            [MessageTypes.NEUTRAL_BASE_CAPTURED, () => this.handleNeutralBaseCaptured(payload)],
            [MessageTypes.UNIT_HEALTH_UPDATE, () => this.handleUnitHealthUpdate(payload)],
            [MessageTypes.SKIN_DATA, () => this.handleSkinData(payload)],
            [MessageTypes.SERVER_VERSION, () => this.handleServerVersion(payload)],
            [MessageTypes.REBOOT_ALERT, () => this.handleRebootAlert(payload)],
            [MessageTypes.PLAYER_INACTIVE_WARNING, () => this.handlePlayerInactiveWarning()],
            [MessageTypes.PLAYER_ACTIVE, () => this.handlePlayerActive()],
            [MessageTypes.X1_CHALLENGE_RECEIVED, () => this.handleX1ChallengeReceived(payload)],
            [MessageTypes.X1_CHALLENGE_RESULT, () => this.handleX1ChallengeResult(payload)],
            [MessageTypes.X1_DUEL_ARENA_UPDATE, () => this.handleX1DuelArenaUpdate(payload)],
            [MessageTypes.WILD_PORTALS_UPDATE, () => this.handleWildPortalsUpdate(payload)],
            [MessageTypes.ERROR, () => this.handleError(payload)],
        ]);

        // Execute the handler if it exists
        const handler = messageHandlers.get(type);
        if (handler) {
            handler();
        }
    }

    // Reset the last resource update ping timeout
    resetLastPing () {
        // Clear existing timeout if there is one
        if (this.lastPing) {
            clearTimeout(this.lastPing);
        }

        // Set a new timeout to log a message after 2 seconds
        this.lastPing = setTimeout(() => {
            console.log("No resource update received within 2 seconds (last ping).");
            this.sendResyncRequest();
        }, 2000);
    }

    handleInitialBulletStates (payload) {
        // ! Currently only receives Trapper Bullets
        const bulletDetails = getBulletDetails(BuildingTypes.SNIPER_TURRET, BuildingVariantTypes.SNIPER_TURRET.TRAPPER);
        const bulletStates = payload;
        bulletStates.forEach(state => {
            const { isPlayer, ownerID, bulletID, position } = state;
            let base = null;
            if (isPlayer) {
                base = this.core.gameManager.getPlayerById(ownerID);
            } else /*isNeutral*/ {
                base = this.core.gameManager.getNeutralById(ownerID);
            }
            if (!base) return
            const bullet = new Bullet(bulletDetails, base.color, position, bulletID);
            base.addBullet(bullet)
        });
    }

    handleSkinData (payload) {
        const { skinData } = payload;
        SkinCache.setSkinData(skinData);
    }

    handleServerVersion(payload) {
        const { version } = payload;
        const expectedVersion = localStorage.getItem('expectedServerVersion');
        const isCorrectVersion = this.core.requiredServerVersion === version;
    
        if (!isCorrectVersion) {
            console.warn(`Incompatible server version: expected ${this.core.requiredServerVersion}, but got ${version}. Reloading...`);
            SkinCache.clearSkinData();
            localStorage.setItem('expectedServerVersion', this.core.requiredServerVersion);
            window.location.reload();
        } else if (expectedVersion !== this.core.requiredServerVersion) {
            console.log('Server and client versions match, but expected version has changed. Fetching new skin data...');
            SkinCache.clearSkinData(); // Clear outdated skin data
            localStorage.setItem('expectedServerVersion', this.core.requiredServerVersion); 
            this.sendSkinDataRequest();
        } else if (SkinCache.isSkinDataEmpty()) {
            this.sendSkinDataRequest();
        }
    }

    handleRebootAlert (payload) {
        const { minutesLeft } = payload;
        this.core.uiManager.setServerRebootAlert(minutesLeft);
    }

    handleError (payload) {
        if (payload?.code === ErrorCodes.RELOCATE_COOLDOWN) {
            const remaining = Number.isFinite(payload.remainingSeconds) ? payload.remainingSeconds : 0;
            const minutes = Math.floor(remaining / 60);
            const seconds = remaining % 60;
            const formatted = minutes > 0
                ? `${minutes}m ${String(seconds).padStart(2, "0")}s`
                : `${seconds}s`;

            this.core.uiManager.addChatMessage(
                "System",
                `Base relocation cooldown active. Wait ${formatted}.`,
                "#ffcc66"
            );
            return;
        }

        if (payload?.code === ErrorCodes.UNAUTHORIZED_EXTENSION) {
            if (this.pendingUnauthorizedJoinBlockNotice) {
                this.pendingUnauthorizedJoinBlockNotice = false;
                return;
            }
            this.showUnauthorizedExtensionBlock();
            return;
        }

        this.core.uiManager.showMenuDialog(
            "Connection Issue",
            "Oops! We couldn't connect to the server.",
            "The server might be <b>full</b> or <b>temporarily</b> down.",
            "<p>Give it another shot later. Thanks for your patience!</p>"
        );
    }

    handleChatMessage (payload) {
        const { playerID, message } = payload;
        const player = this.core.gameManager.getPlayerById(playerID);
        if (!player) return;
        this.core.uiManager.addChatMessage(player.name, message, player.color, player);
    }

    handleGameState (payload) {
        const { players, neutralBases, bushes, rocks, wildPortals = [] } = payload;
        const clientPlayer = this.core.gameManager.player;
        // Reset game state and clear render queues
        this.core.gameManager.reset();
        this.core.renderer.clearQueues();

        // Helper function to add buildings to a player or neutral base
        const addBuildings = (owner, buildings) => {
            buildings.forEach(building => {
                const BuildingClass = BuildingManager.getBuildingClassByType(building.type);
                if (!BuildingClass) {
                    console.warn(`Building type '${building.type}' not defined!`);
                    return;
                }
                const newBuilding = new BuildingClass(owner.color, building.position, building.variant, building.id);
                if (typeof newBuilding.setPlacementRotationStep === "function") {
                    newBuilding.setPlacementRotationStep(building.rotationStep || 0);
                }
                owner.addBuilding(newBuilding);

                if (building.type === BuildingTypes.BARRACKS) {
                    newBuilding.activated = building.unitSpawningActive;
                    if (newBuilding.activated && owner.isClient) {
                        this.core.gameManager.increaseActiveBarracks(1);
                    }
                }

                if (owner.isClient) {
                    this.core.gameManager.increaseBuildingLimit(building.type);
                }
            });
        };

        // Helper function to add units to a player
        const addUnits = (player, units) => {
            units.forEach(unit => {
                const UnitClass = UnitManager.getUnitClassByType(unit.type);
                if (!UnitClass) {
                    console.warn(`Unit type '${unit.type}' not defined!`);
                    return;
                }

                const newUnit = new UnitClass(player.color, unit.position, unit.variant, unit.id);

                player.addUnit(newUnit);
                if (player.isClient && newUnit.type === UnitTypes.COMMANDER) {
                    this.core.gameManager.setCommander(true);
                    this.core.unitManager?.onClientCommanderSpawned?.(newUnit);
                }
            });
        };

        // Process each player in the game state
        players.forEach(playerData => {
            const { id, name, color, skinID, position, health, hasSpawnProtection } = playerData;
            
            // For the client player, use local selected skin only as fallback if server skin is missing.
            let playerSkinID = skinID;
            if (clientPlayer && clientPlayer.id === id) {
                const localSkinName = localStorage.getItem('equippedSkinName') || null;
                const localSkinNumeric = localStorage.getItem('equippedSkin') || null;
                const serverHasSkin = !(playerSkinID == null || playerSkinID === 0 || playerSkinID === "0" || playerSkinID === "null");
                if (!serverHasSkin) {
                    if (localSkinName && localSkinName !== '' && localSkinName !== 'null') {
                        playerSkinID = localSkinName;
                    } else if (localSkinNumeric && localSkinNumeric !== '' && localSkinNumeric !== 'null') {
                        const parsed = Number(localSkinNumeric);
                        playerSkinID = Number.isNaN(parsed) ? localSkinNumeric : parsed;
                    }
                }
            }
            
            // Create new player instance
            const newPlayer = new Player(id, name, color, playerSkinID, position, health, hasSpawnProtection);

            // Set as client player if matched
            if (clientPlayer && clientPlayer.id === id) {
                this.core.gameManager.setClientPlayer(newPlayer);
                this.core.toolbar.changeColor(newPlayer.color);
            }

            // Add buildings and units to the player
            addBuildings(newPlayer, playerData.buildings);
            addUnits(newPlayer, playerData.units);

            // If this is the client player, assign it to the gameManager
            if (!newPlayer.isClient) {
                this.core.gameManager.addPlayer(newPlayer);
            }

        });

        // Process neutral bases
        neutralBases.forEach(neutral => {
            const { id, ownerID, health, position, buildings } = neutral;

            // Create new neutral base instance
            const newNeutral = new NeutralBase(id, position, health, ownerID);

            if (clientPlayer && ownerID != -1) {
                if (ownerID == clientPlayer.id) {
                    newNeutral.setAsClientPlayer();
                }
            }

            // Add buildings to the neutral base
            addBuildings(newNeutral, buildings);

            this.core.gameManager.addNeutral(newNeutral);

            const player = this.core.gameManager.getPlayerById(ownerID);
            if (!player) return;

            this.core.gameManager.setNeutralCaptured(player, newNeutral);
        });

        // Process bushes 
        bushes.forEach(position => {
            this.core.gameManager.addBush(new Bush(position));
        });

        // Sort the rocks array by size, in ascending order
        rocks.sort((a, b) => b.Size - a.Size);

        // Process rocks 
        rocks.forEach(rock => {
            this.core.gameManager.addRock(new Rock(rock.position, rock.size, rock.rotation));
        });

        this.core.gameManager.setWildPortals(
            wildPortals.map(p => new WildPortal(p.id, p.position))
        );

        // Hide the connecting overlay once game state is synced
        this.core.uiManager.showConnectingOverlay(false);
    }

    handleWildPortalsUpdate (payload) {
        const { wildPortals = [] } = payload;
        this.core.gameManager.setWildPortals(
            wildPortals.map(p => new WildPortal(p.id, p.position))
        );
    }

    handleInitialPlayerData (payload) {
        const { playerID, name, color, skinID, position } = payload;
        
        // Get the selected skin from localStorage (for both guests and logged in users)
        let selectedSkin = localStorage.getItem('equippedSkinName') || localStorage.getItem('equippedSkin') || null;
        
        // If logged in, prefer userData's selected_skin
        if (this.loggedIn && this.userData && this.userData.selected_skin) {
            selectedSkin = this.userData.selected_skin;
        }
        
        // Normalize empty values
        if (selectedSkin === '' || selectedSkin === 'null' || selectedSkin === '0') {
            selectedSkin = null;
        } else if (typeof selectedSkin === 'string' && /^\d+$/.test(selectedSkin)) {
            selectedSkin = Number(selectedSkin);
        }
        
        const resolvedSkin = (skinID != null && skinID !== 0 && skinID !== "0" && skinID !== "null")
            ? skinID
            : selectedSkin;
        console.log('Creating player with skin:', resolvedSkin);
        
        // Use server skin when present; local selection is fallback only for the local player.
        const player = new Player(playerID, name, color, resolvedSkin, position);
        player.hasSpawnProtection = true;
        this.core.gameManager.setClientPlayer(player);
        this.core.toolbar.changeColor(player.color);
        this.core.leaderboard.clear();
        this.core.camera.enableControls(true);
        this.core.camera.setPosition(position);
        // Spawn directly at gameplay zoom (no intro zoom animation)
        this.core.camera.zoom = 0.75;
        this.core.camera.targetZoom = 0.75;

        this.core.gameManager.stats.time = Date.now();
        this.core.buildingManager.announceDefenseHotkeys();
    }

    handleDiscordOnboardingNotice () {
        let alreadySeen = false;
        try {
            alreadySeen = localStorage.getItem(this.discordOnboardingSeenKey) === "1";
        } catch (error) {
            alreadySeen = false;
        }

        if (!alreadySeen) {
            this.core.uiManager.showDiscordJoinPrompt(this.discordInviteUrl);
            try {
                localStorage.setItem(this.discordOnboardingSeenKey, "1");
            } catch (error) {}
            return;
        }

        this.core.uiManager.addChatMessage(
            "System",
            `Join our Discord community: ${this.discordInviteUrl}`,
            "#60c1ff"
        );
    }

    handleResourceUpdate (payload) {
        const { power, generatingPower } = payload;
        const resources = this.core.gameManager.resources;
        resources.power.current = power;
        resources.power.generationRate = generatingPower;
        this.core.uiManager.updateResources();
    }

    handleSpawnUnit (payload) {
        const { isPlayer, ownerID, barracksID, unitID, unitType, unitVariant, targetPosition } = payload;
        let base = null;
        let player = null;

        if (isPlayer) {
            base = this.core.gameManager.getPlayerById(ownerID);
            player = base;
        } else/*isNeutral*/ {
            base = this.core.gameManager.getNeutralById(ownerID);
            player = this.core.gameManager.getPlayerById(base.ownerID);
        }

        if (!base) return;

        const UnitClass = UnitManager.getUnitClassByType(unitType);
        if (!UnitClass) {
            console.log("UnitClass not defined!");
            return;
        }
        let initialPosition = { ...player.position };

        let barracks;
        if (barracksID !== -1) {
            barracks = base.getBuilding(barracksID)
            if (barracks) {
                initialPosition = { ...barracks.position };
            }
        }

        const unit = new UnitClass(base.color, initialPosition, unitVariant, unitID)
        if (barracks) {
            player.spawnUnit(unit, targetPosition);
        } else {
            // Add without targetPosition
            //? This always handles Commander spawns, because commanders dont spawn in barracks
            //? and doesnt need the layering while spawning
            if (targetPosition) {
                unit.setTargetPosition(targetPosition);
            }
            player.addUnit(unit);
        }

        if (player.isClient && unit.type === UnitTypes.COMMANDER) {
            this.core.gameManager.setCommander(true);
            this.core.unitManager?.onClientCommanderSpawned?.(unit);
        }
    }

    handleUnitsPositionUpdate (payload) {
        const { playerID, units } = payload;
        const player = this.core.gameManager.getPlayerById(playerID);
        if (!player) return;

        units.forEach(unit => {
            const u = player.getUnit(unit.id);
            if (u) {
                u.setTargetPosition(unit.targetPosition);
            }
        });
    }

    handleUnitsRotationUpdate (payload) {
        const { playerID, units } = payload;
        const player = this.core.gameManager.getPlayerById(playerID);
        if (!player) return;
        units.forEach(unit => {
            const u = player.getUnit(unit.id);
            if (u) {
                u.setRotation(unit.rotation);
            }
        });
    }

    handleRemoveUnit (payload) {
        const { playerID, unitID } = payload;

        const player = this.core.gameManager.getPlayerById(playerID);
        if (!player) return;

        if (player.isClient) {
            const index = this.core.unitManager.selectedUnits.findIndex(unit => unit.id === unitID);
            if (index !== -1) {
                // Remove unit, from selected units
                this.core.unitManager.selectedUnits.splice(index, 1);
            }
        }

        const unit = player.getUnit(unitID);

        if (unit) {
            if (unit.type === UnitTypes.DRONE && unit.variant === UnitVariantTypes.DRONE.KAMIKAZE) {
                const radius = unit.details.explosionRadius;
                this.core.renderer.addToQueue(new Explosion(unit.position, player.color, radius, 1), QueueType.EFFECT);
            }
            // Calculate explosion angle based on unit's target position
            const explosionAngle = Math.atan2(unit.targetPosition.y - unit.position.y, unit.targetPosition.x - unit.position.x);
            this.core.renderer.addToQueue(new Particle(unit.position, explosionAngle, player.color, 1), QueueType.EFFECT);
            player.markUnitForRemoval(unitID);

            if (player.isClient && unit.type === UnitTypes.COMMANDER) {
                this.core.gameManager.setCommander(false);
            }

        }
    }

    handleTurretRotationUpdate (payload) {
        // ! Currently  only receives normal turret data (not unit turrets, they are still calculated locally)
        const { isPlayer, ownerID, turretID, rotation } = payload;
        let base = null;
        if (isPlayer) {
            base = this.core.gameManager.getPlayerById(ownerID);
        } else /*isNeutral*/ {
            base = this.core.gameManager.getNeutralById(ownerID);
        }
        if (!base) return;
        const turret = base.getBuilding(turretID);
        if (!turret) return;
        turret.setRotation(rotation);
    }

    handleNeutralBaseCaptured (payload) {
        const { neutralID, playerID, buildings } = payload;
        const neutral = this.core.gameManager.getNeutralById(neutralID);

        // If no playerID is provided, reset the neutral base
        if (playerID == null) {
            if (!neutral) return; // Exit if neutral does not exist
            neutral.reset(); // Reset the neutral base
            return;
        }

        const player = this.core.gameManager.getPlayerById(playerID);
        if (!player) return; // Exit if the player does not exist   


        // Rest health
        neutral.setHealth(neutral.health.max);

        // Set the neutral base as captured by the player
        this.core.gameManager.setNeutralCaptured(player, neutral);


        // Clear all old buildings and bullets from the neutral base
        neutral.clear(); //! Needs to be cleared after setNeutralCaptured
        //! Because before that the old buildingLimits need to reset

        // Now, add the initial buildings to the neutral base
        if (buildings) {
            buildings.forEach(building => {
                // Get the Building class by type
                const BuildingClass = BuildingManager.getBuildingClassByType(building.type);
                if (!BuildingClass) {
                    console.error("BuildingType not defined for:", building.type);
                    return;
                }
                // Create a new building if no cached building is found
                const newBuilding = new BuildingClass(player.color, building.position, building.variant, building.id);
                if (typeof newBuilding.setPlacementRotationStep === "function") {
                    newBuilding.setPlacementRotationStep(building.rotationStep || 0);
                }
                neutral.addBuilding(newBuilding);

                if (player.isClient) {
                    this.core.gameManager.increaseBuildingLimit(newBuilding.type);
                }
            });
        }
    }

    handleUnitHealthUpdate (payload) {
        const { playerID, unitID, health } = payload;
        const player = this.core.gameManager.getPlayerById(playerID);
        if (!player) return;

        const unit = player.getUnit(unitID);
        if (unit) {
            unit.setHealth(health);
        }
    }

    handlePlayerJoined (payload) {
        const { playerID, color, skinID, position, name } = payload;
        const player = new Player(playerID, name, color, skinID, position);
        this.core.gameManager.addPlayer(player);
    }

    handlePlayerLeft (payload) {
        const { playerID } = payload;
        this.core.gameManager.removeGlobalDuelArenasByPlayer(playerID);
        if (this.core.gameManager.duelOpponentID === playerID) {
            this.core.gameManager.clearDuelArena();
            this.core.uiManager.hideX1DuelStatus();
        }
        this.core.gameManager.removePlayer(playerID);
        this.core.leaderboard.removePlayer(playerID);
    }

    _updateUserDataLocally (score, xp, kills, playDuration) {
        const BASE_XP = 50; // Base XP needed for level 1
        const VETERAN_SKIN_BASE_ID = 99; // Starting ID for veteran skins
        const LEVEL_UNLOCK_INTERVAL = 5; // Interval for unlocking veteran skins

        if (!this.userData) {
            return;
        }

        let progression = this.userData.progression || {
            level: Number(this.userData.level || 1),
            xp: Number(this.userData.xp || 0)
        };
        let skins = this.userData.skins || {}; // Ensure skins is an object
        let statistics = this.userData.statistics || {
            highscore: Number(this.userData.highscore || 0),
            kills: Number(this.userData.total_kills || this.userData.kills || 0),
            playtime: Number(this.userData.playtime || 0)
        };

        const safeXP = Number.isFinite(Number(xp)) ? Number(xp) : 0;
        const safeKills = Number.isFinite(Number(kills)) ? Number(kills) : 0;
        const safeScore = Number.isFinite(Number(score)) ? Number(score) : 0;

        progression.xp += safeXP;

        const calculateRequiredXP = (level) => {
            return Math.round(BASE_XP * Math.pow(level, 1.1));
        };

        let requiredXP = calculateRequiredXP(progression.level);

        // Level up if XP exceeds the required XP for the current level
        while (progression.xp >= requiredXP) {
            progression.level++;
            progression.xp -= requiredXP;

            // Unlock veteran skins every `LEVEL_UNLOCK_INTERVAL` levels
            if (progression.level % LEVEL_UNLOCK_INTERVAL === 0) {
                const newSkinId = VETERAN_SKIN_BASE_ID + Math.floor(progression.level / LEVEL_UNLOCK_INTERVAL);
                skins.unlocked = skins.unlocked || []; // Ensure unlocked is an array

                // Add skin only if not already unlocked
                if (!skins.unlocked.includes(newSkinId)) {
                    skins.unlocked.push(newSkinId);
                }
            }

            // Update required XP for the next level
            requiredXP = calculateRequiredXP(progression.level);
        }

        // Update playtime safely
        if (typeof playDuration === "number" && playDuration > 0) {
            statistics.playtime = statistics.playtime || 0; // Ensure playtime exists
            statistics.playtime += playDuration;
        }

        // Update kills
        statistics.kills = (statistics.kills || 0) + safeKills;

        // Update high score if needed
        if (statistics.highscore === undefined || statistics.highscore < safeScore) {
            statistics.highscore = safeScore;
        }

        // Save changes to userData (if necessary)
        this.userData.skins = skins;
        this.userData.statistics = statistics;
        this.userData.progression = progression;
        this.userData.highscore = statistics.highscore;
        this.userData.total_kills = statistics.kills;
        this.userData.playtime = statistics.playtime;
        this.userData.level = progression.level;
        this.userData.xp = progression.xp;

        // Persist local snapshot immediately so F5 keeps latest round stats
        try {
            const minimal = {
                id: this.userData.id || this.userId,
                email: this.getCurrentKnownEmail() || null,
                nickname: this.userData.nickname,
                role: this.userData.role || "user",
                skins: this.userData.skins || {},
                progression,
                statistics,
                highscore: statistics.highscore,
                total_kills: statistics.kills,
                playtime: statistics.playtime,
                level: progression.level,
                xp: progression.xp
            };
            localStorage.setItem("blobl_user_data", JSON.stringify(minimal));
        } catch (e) {
            console.warn("Could not persist round stats locally:", e);
        }

        // Trigger UI refresh
        this.core.uiManager.updateAccount();
    }

    async _persistUserDataStats () {
        if (!this.loggedIn || !this.userId || !this.userData) {
            return;
        }

        const progression = this.userData.progression || {
            level: Number(this.userData.level || 1),
            xp: Number(this.userData.xp || 0)
        };

        const statistics = this.userData.statistics || {
            highscore: Number(this.userData.highscore || 0),
            kills: Number(this.userData.total_kills || this.userData.kills || 0),
            playtime: Number(this.userData.playtime || 0)
        };

        // Keep local cache updated regardless of remote success.
        try {
            const minimal = {
                id: this.userData.id || this.userId,
                email: this.getCurrentKnownEmail() || null,
                nickname: this.userData.nickname,
                role: this.userData.role || "user",
                skins: this.userData.skins || {},
                progression,
                statistics,
                highscore: statistics.highscore,
                total_kills: statistics.kills,
                playtime: statistics.playtime,
                level: progression.level,
                xp: progression.xp
            };
            localStorage.setItem("blobl_user_data", JSON.stringify(minimal));
        } catch (e) {
            console.warn("Could not persist user stats to localStorage:", e);
        }

        const result = await updateUserProgressStats(this.userId, progression, statistics);
        if (!result?.success) {
            console.warn("Remote stats sync failed; local stats were kept.");
            return;
        }

        this._lastSyncedStatsSignature = this._buildStatsSignature(statistics);

        // Force next global-rank read to use fresh DB values after successful sync.
        invalidateGlobalLeaderboardCache();
        if (typeof this.core?.uiManager?._populateGlobalLeaderboard === "function") {
            this.core.uiManager._populateGlobalLeaderboard();
        }
    }

    handleKilled (payload) {
        const { killerID, score, xp, kills, playtime } = payload;
        const killer = this.core.gameManager.getPlayerById(killerID);
        if (!killer) return;
        this.core.gameManager.clearDuelArena();
        this.core.uiManager.hideX1DuelStatus();
        this.core.gameManager.player = null; //? Invalidate the client player, to make GameState work correcly
        this.core.uiManager.gameOver(killer, score);

        this._updateUserDataLocally(score, xp, kills, playtime);
        this._persistUserDataStats();
    }

    handleKickNotification (payload) {
        const { reason, score, xp, kills, playtime } = payload;
        this.core.gameManager.clearDuelArena();
        this.core.uiManager.hideX1DuelStatus();
        this.core.uiManager.kicked(reason, score);
        console.log(payload)
        this._updateUserDataLocally(score, xp, kills, playtime);
        this._persistUserDataStats();
    }

    handleBaseHealthUpdate (payload) {
        const { isPlayer, ownerID, health } = payload;
        const gameManager = this.core.gameManager;

        if (isPlayer) {
            const player = gameManager.getPlayerById(ownerID);
            if (!player) return;
            player.setHealth(health);
        } else /*isNeutral*/ {
            const neutral = gameManager.getNeutralById(ownerID);
            neutral.setHealth(health);
        }
    }

    handleBuildingPlaced (payload) {
        const { isPlayer, ownerID, buildingID, buildingType, rotationStep, position, unitSpawningActive } = payload;
        let base = null;
        let player = null;
        let isClient = false;

        // Determine if the base is a player or a neutral and retrieve associated objects
        if (isPlayer) {
            base = this.core.gameManager.getPlayerById(ownerID);
            player = base; // Player is the base itself
            isClient = player.isClient;
        } else /*isNeutral*/ {
            base = this.core.gameManager.getNeutralById(ownerID);
            player = this.core.gameManager.getPlayerById(base.ownerID);
            isClient = player.isClient;
        }

        // Check if base is valid
        if (!base) {
            console.error("Base not found for owner ID:", ownerID);
            return;
        }

        // Get the Building class by type
        const BuildingClass = BuildingManager.getBuildingClassByType(buildingType);
        if (!BuildingClass) {
            console.error("BuildingType not defined for:", buildingType);
            return;
        }

        let building;

        if (isClient) {
            // Attempt to retrieve a cached building
            const cachedBuilding = player.getBuildingCache();
            const canUseCachedBuilding = cachedBuilding && cachedBuilding.type === buildingType;
            if (canUseCachedBuilding) {
                building = cachedBuilding; // Use cached building if available
                player.clearBuildingCache(); // Clear cache after use
                building.id = buildingID; // Set a valid building ID
                building.setPosition(position); // Correct position based on client prediction
            } else {
                if (cachedBuilding) {
                    // Cache may arrive out-of-order during fast autobuild bursts.
                    // Ignore mismatched cache to avoid rendering wrong building classes.
                    player.clearBuildingCache();
                }
                // Create a new building if no cached building is found
                building = new BuildingClass(player.color, position, 0, buildingID);
            }

            // Reset unit upgrades if the building is an Armory
            if (building.type === BuildingTypes.ARMORY) {
                this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BASIC);
            }

        } else {
            // Handle non-Client player placements
            building = new BuildingClass(player.color, position, 0, buildingID);
        }

        if (typeof building?.setPlacementRotationStep === "function") {
            building.setPlacementRotationStep(rotationStep || 0);
        }

        if (building.type === BuildingTypes.BARRACKS) {
            building.activated = unitSpawningActive;
            if (building.activated && isClient) {
                this.core.gameManager.increaseActiveBarracks(1);
            }
        }

        // Add the building to the base (player or neutral)
        base.addBuilding(building);

        // Clear the building cache after a slight delay to prevent flickering
        if (isClient) {
            setTimeout(() => {
                player.clearBuildingCache();
            }, 20); // Delay of 20ms
        }
    }

    handleBuildingPlacementFailed (payload) {
        const { buildingType, reason, cooldownSeconds } = payload;
        this.core.gameManager.decreaseBuildingLimit(buildingType);
        this.core.gameManager.player?.clearBuildingCache?.();

        if (buildingType === BuildingTypes.PORTAL && reason === BuildingPlacementFailReasons.PORTAL_COOLDOWN) {
            this.core.gameManager.portalCooldownEndsAt = Date.now() + cooldownSeconds * 1000;
            const mins = Math.ceil(cooldownSeconds / 60);
            this.core.uiManager.addChatMessage(
                "System",
                `Portal is on cooldown. Wait about ${mins} min to buy again.`,
                "#ffcc66"
            );
            return;
        }

        this.core.uiManager.addChatMessage(
            "System",
            "Placement failed (invalid position/collision).",
            "#ffcc66"
        );
    }

    handleBuildingsUpgraded (payload) {
        const { isPlayer, ownerID, buildingIDs, buildingVariant } = payload;
        let base = null;
        let isClient = false;

        if (isPlayer) {
            base = this.core.gameManager.getPlayerById(ownerID);
            isClient = base.isClient;
        } else /*isNeutral*/ {
            base = this.core.gameManager.getNeutralById(ownerID);
            const owner = this.core.gameManager.getPlayerById(base.ownerID);
            if (owner) {
                isClient = owner.isClient;
            }
        }

        if (!base) return;

        base.upgradeBuildings(buildingIDs, buildingVariant);

        if (isClient) {
            const hasArmory = buildingIDs.some(id => {
                const b = base.getBuilding(id);
                return b && b.type === BuildingTypes.ARMORY;
            });
            if (hasArmory) {
                if (buildingVariant === BuildingVariantTypes.ARMORY.POWER_ARMOR) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.LIGHT_ARMOR);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BASIC);
                } else if (buildingVariant === BuildingVariantTypes.ARMORY.BOOSTER_ENGINES) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BOOSTER_ENGINE);
                } else if (buildingVariant === BuildingVariantTypes.ARMORY.PANZER_CANNONS) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.CANNON);
                } else if (buildingVariant === BuildingVariantTypes.ARMORY.PANZER_CANNONS_COMBO) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BOOSTER_ENGINE_CANNON);
                } else if (buildingVariant === BuildingVariantTypes.ARMORY.CLOAKING_DEVICE) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BASIC);
                } else if (buildingVariant === BuildingVariantTypes.ARMORY.BOOSTER_CLOAK_COMBO) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BOOSTER_ENGINE);
                } else if (buildingVariant === BuildingVariantTypes.ARMORY.PANZER_CLOAK_COMBO) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.CANNON);
                } else if (buildingVariant === BuildingVariantTypes.ARMORY.PANZER_BOOSTER_CLOAK_COMBO) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BOOSTER_ENGINE_CANNON);
                }
            }
        }
    }

    handleBuildingsRemoved (payload) {
        const { isPlayer, ownerID, buildingIDs } = payload;
        if (isPlayer) {
            const player = this.core.gameManager.getPlayerById(ownerID);
            if (!player) return;
            const callback = player.isClient ? ((building) => {
                this.core.gameManager.decreaseBuildingLimit(building.type);
                if (building.type === BuildingTypes.ARMORY) {
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                    this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BASIC);
                } else if (building.type === BuildingTypes.BARRACKS) {
                    if (building.activated) {
                        this.core.gameManager.decreaseActiveBarracks(1);
                    }
                }
            }) : () => { };

            for (const buildingID of buildingIDs) {
                player.markBuildingForRemoval(buildingID, callback);
            }

        } else /*isNeutral*/ {
            const neutral = this.core.gameManager.getNeutralById(ownerID);
            if (!neutral) return;
            let callback = () => { };
            if (neutral.ownerID) {
                const player = this.core.gameManager.getPlayerById(neutral.ownerID)
                callback = player.isClient ? ((building) => {
                    this.core.gameManager.decreaseBuildingLimit(building.type);
                    if (building.type === BuildingTypes.ARMORY) {
                        this.core.gameManager.applyUnitUpgrade(UnitTypes.SOLDIER, UnitVariantTypes.SOLDIER.BASIC);
                        this.core.gameManager.applyUnitUpgrade(UnitTypes.TANK, UnitVariantTypes.TANK.BASIC);
                    } else if (building.type === BuildingTypes.BARRACKS) {
                        if (building.activated) {
                            this.core.gameManager.decreaseActiveBarracks(1);
                        }
                    }
                }) : () => { };
            }

            for (const buildingID of buildingIDs) {
                neutral.markBuildingForRemoval(buildingID, callback);
            }
        }
    }

    handleBarracksActivationUpdate (payload) {
        const { isPlayer, ownerID, buildingID, isActivated } = payload;

        let base = null;
        if (isPlayer) {
            base = this.core.gameManager.getPlayerById(ownerID);
        } else /*isNeutral*/ {
            base = this.core.gameManager.getNeutralById(ownerID);
        }
        if (!base) return;

        const barracks = base.getBuilding(buildingID);
        if (!barracks) return;
        barracks.activated = isActivated;
    }

    handleSpawnBullet (payload) {
        const { isPlayer, ownerID, objectID, bulletID } = payload;
        const bulletPosition = payload.position || payload.targetPosition;
        const buildingID = objectID;
        let base = null;
        if (isPlayer) {
            base = this.core.gameManager.getPlayerById(ownerID);
        } else /*isNeutral*/ {
            base = this.core.gameManager.getNeutralById(ownerID);
        }
        if (!base || !bulletPosition) return;

        const turret = base.getBuilding(buildingID);
        if (!turret?.bulletDetails) return;
        const bullet = new Bullet(turret.bulletDetails, base.color, bulletPosition, bulletID);
        const initialTargetPosition = turret.targetPoint || bulletPosition;
        base.spawnBullet(bullet, initialTargetPosition, turret);
    }

    handleUnitSpawnBullet (payload) {
        const { playerID, objectID, bulletID } = payload;
        const bulletPosition = payload.position || payload.targetPosition;
        const bulletTargetPosition = payload.targetPosition || null;
        const unitID = objectID;
        const player = this.core.gameManager.getPlayerById(playerID);
        if (!player || !bulletPosition) return;

        const unit = player.getUnit(unitID);
        if (!unit?.bulletDetails) return;

        const bullet = new Bullet(unit.bulletDetails, player.color, bulletPosition, bulletID);
        let initialTargetPosition = bulletTargetPosition || unit.targetPosition || bulletPosition;
        if (!bulletTargetPosition && unit.type === UnitTypes.COMMANDER && bulletPosition) {
            const unitPosition = unit.position || unit.targetPosition || bulletPosition;
            const dirX = Number(bulletPosition.x) - Number(unitPosition.x);
            const dirY = Number(bulletPosition.y) - Number(unitPosition.y);
            if (Number.isFinite(dirX) && Number.isFinite(dirY) && Math.hypot(dirX, dirY) > 0.01) {
                initialTargetPosition = {
                    x: unitPosition.x + dirX * 2,
                    y: unitPosition.y + dirY * 2
                };
            }
        }
        player.spawnBullet(bullet, initialTargetPosition, unit);
    }

    handleRemoveBullet (payload) {
        const { isPlayer, ownerID, bulletID } = payload;
        let base = null;
        if (isPlayer) {
            base = this.core.gameManager.getPlayerById(ownerID);
        } else /*isNeutral*/ {
            base = this.core.gameManager.getNeutralById(ownerID);
        }
        if (!base) return;

        base.markBulletForRemoval(bulletID);
    }

    handleBulletPositionUpdate (payload) {
        const { isPlayer, ownerID, bulletID, targetPosition } = payload;
        const bulletPosition = targetPosition;
        let base = null;
        if (isPlayer) {
            base = this.core.gameManager.getPlayerById(ownerID);
        } else /*isNeutral*/ {
            base = this.core.gameManager.getNeutralById(ownerID);
        }
        if (!base) return;

        const bullet = base.getBullet(bulletID);
        if (bullet) {
            bullet.setTargetPosition(bulletPosition);
        }
    }

    handleLeaderboardUpdate (payload) {
        const { changes } = payload;
        this.core.leaderboard.updateEntries(changes);
        // Trigger near-real-time account stats sync whenever leaderboard score ticks.
        this._runStatsSyncFiveStep();
    }

    handleRemoveSpawnProtection (payload) {
        const { playerID } = payload;
        const player = this.core.gameManager.getPlayerById(playerID);
        if (!player) return;
        player.removeSpawnProtection();
        this.core.renderer.updatePlayerConnections();

        if (this.spawnLeaveWatchers.has(playerID)) {
            const watchedName = this.spawnLeaveWatchers.get(playerID) || player.name || "Player";
            this.core.uiManager.addChatMessage(
                "System",
                `${watchedName} left their base.`,
                "#60c1ff"
            );
            this.spawnLeaveWatchers.delete(playerID);
        }

        if (player.isClient) {
            this.core.uiManager.showSpawnProtectionTimer(false);
        }
    }

    watchPlayerLeaveBase (playerID, playerName = "Player") {
        const target = this.core.gameManager.getPlayerById(playerID);
        if (!target) {
            this.core.uiManager.addChatMessage("System", "Player not found.", "#ffcc66");
            return;
        }

        if (!target.hasSpawnProtection) {
            this.core.uiManager.addChatMessage(
                "System",
                `${target.name || playerName} has already left their base.`,
                "#ffcc66"
            );
            return;
        }

        this.spawnLeaveWatchers.set(playerID, target.name || playerName);
        this.core.uiManager.addChatMessage(
            "System",
            `Notification enabled: I'll alert you when ${target.name || playerName} leaves their base.`,
            "#60c1ff"
        );
        this.sendWatchLeaveBase(playerID);
    }

    // Send a message to the server
    sendMessage (message) {
        if (this.enforceStrictClientSecurity && this.securityViolationReported && message?.type !== MessageTypes.CLIENT_SECURITY_ALERT) {
            return;
        }
        if (message instanceof Message) {
            this.network.sendMessage(message);
        } else {
            console.error("Invalid message format. Message must be an instance of the Message class.");
            // Additional error handling code here (e.g., displaying an error message)
        }
    }

    securityReasonLabel(reasonCode) {
        switch (reasonCode) {
            case SECURITY_ALERT_REASON.DEVTOOLS_SHORTCUT:
                return "DevTools shortcut detected";
            case SECURITY_ALERT_REASON.VIEW_SOURCE_SHORTCUT:
                return "Source/inspect shortcut detected";
            case SECURITY_ALERT_REASON.DEVTOOLS_OPENED:
                return "Developer tools panel detected";
            default:
                return "Security rule triggered";
        }
    }

    showSecurityViolationDialog(reasonCode) {
        const reasonText = this.securityReasonLabel(reasonCode);
        this.core?.uiManager?.showMenuDialog(
            "Security Violation",
            `${reasonText}. Session blocked.`,
            "DevTools/inspect shortcuts are not allowed in this match.",
            "Close DevTools and reload the page if you want to play.",
            "Understood",
            "If this was accidental, refresh and try again."
        );
        this.core?.setGameplayActive?.(false);
    }

    reportClientSecurityViolation(reasonCode) {
        if (!this.enforceStrictClientSecurity) {
            return;
        }
        if (this.securityViolationReported) {
            return;
        }
        this.securityViolationReported = true;
        this.securityViolationReason = reasonCode;
        this.showSecurityViolationDialog(reasonCode);

        const msg = Message.createClientSecurityAlertMessage(reasonCode);
        this.sendMessage(msg);

        try {
            this.network?.worker?.postMessage?.({ type: "disconnect" });
        } catch (error) {}
    }

    markSecurityViewportChange() {
        this.lastSecurityViewportChangeAt = Date.now();
        this.devtoolsOpenStreak = 0;
    }

    isLikelyBrowserFullscreen() {
        if (typeof window === "undefined" || typeof screen === "undefined") {
            return false;
        }

        const viewportWidth = Number(window.innerWidth || 0);
        const viewportHeight = Number(window.innerHeight || 0);
        const screenWidth = Number(window.screen?.width || 0);
        const screenHeight = Number(window.screen?.height || 0);
        if (viewportWidth <= 0 || viewportHeight <= 0 || screenWidth <= 0 || screenHeight <= 0) {
            return false;
        }

        return Math.abs(viewportWidth - screenWidth) <= 2 && Math.abs(viewportHeight - screenHeight) <= 2;
    }

    setupClientSecurityGuards() {
        if (!this.enforceStrictClientSecurity || this.securityGuardBound || typeof window === "undefined") {
            return;
        }
        this.securityGuardBound = true;

        const onViewportChange = () => this.markSecurityViewportChange();
        window.addEventListener("resize", onViewportChange, true);
        window.addEventListener("orientationchange", onViewportChange, true);
        window.addEventListener("fullscreenchange", onViewportChange, true);
        window.addEventListener("webkitfullscreenchange", onViewportChange, true);

        window.addEventListener("keydown", (event) => {
            if (this.securityViolationReported) {
                return;
            }

            const keyRaw = String(event.key || "");
            const key = keyRaw.toLowerCase();
            const keyUpper = keyRaw.toUpperCase();
            const codeRaw = String(event.code || "");
            const codeUpper = codeRaw.toUpperCase();
            const ctrlOrMeta = event.ctrlKey || event.metaKey;
            let reason = 0;

            if (keyUpper === "F11" || codeUpper === "F11") {
                this.markSecurityViewportChange();
            }

            if (keyUpper === "F12" && (!codeUpper || codeUpper === "F12")) {
                reason = SECURITY_ALERT_REASON.DEVTOOLS_SHORTCUT;
            } else if (ctrlOrMeta && event.shiftKey && (key === "i" || key === "j" || key === "c" || key === "k")) {
                reason = SECURITY_ALERT_REASON.DEVTOOLS_SHORTCUT;
            } else if (ctrlOrMeta && (key === "u" || key === "s")) {
                reason = SECURITY_ALERT_REASON.VIEW_SOURCE_SHORTCUT;
            }

            if (reason !== 0) {
                event.preventDefault();
                event.stopPropagation();
                this.reportClientSecurityViolation(reason);
            }
        }, true);

        this.devtoolsDetectorTimer = window.setInterval(() => {
            if (this.securityViolationReported) {
                return;
            }
            const now = Date.now();
            if (now - this.lastSecurityViewportChangeAt < VIEWPORT_CHANGE_COOLDOWN_MS || this.isLikelyBrowserFullscreen()) {
                this.devtoolsOpenStreak = 0;
                return;
            }
            const widthGap = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
            const heightGap = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
            const looksOpen = widthGap > DEVTOOLS_GAP_THRESHOLD || heightGap > DEVTOOLS_GAP_THRESHOLD;

            if (looksOpen) {
                this.devtoolsOpenStreak += 1;
            } else {
                this.devtoolsOpenStreak = 0;
            }

            if (this.devtoolsOpenStreak >= DEVTOOLS_OPEN_STREAK_REQUIRED) {
                this.reportClientSecurityViolation(SECURITY_ALERT_REASON.DEVTOOLS_OPENED);
            }
        }, 700);
    }

    getKnownEditingExtensionCatalog () {
        return KNOWN_GAME_EDITING_EXTENSIONS.map((ext) => ext.label);
    }

    scanJoinEnvironmentForUnauthorizedExtensions () {
        const strongDetected = new Set();
        const weakDetected = new Set();
        const addDetected = (label, isStrong = false) => {
            if (typeof label === "string" && label.trim() !== "") {
                if (isStrong) {
                    strongDetected.add(label);
                } else {
                    weakDetected.add(label);
                }
            }
        };
        const inspectTextForExtension = (value, fallbackLabel = "", allowWeakTokens = true) => {
            const text = String(value || "").toLowerCase();
            if (!text) return;

            if (text.includes(".user.js")) {
                addDetected("UserScript (*.user.js)", true);
                addUserscriptSource(text);
            }

            const hasKnownToken = hasKnownEditingExtensionToken(text);
            const hasInjectedScriptMarker = INJECTED_SCRIPT_MARKERS.some((marker) => text.includes(marker));

            if (EXTENSION_SCHEME_MARKERS.some((scheme) => text.includes(scheme)) && (hasKnownToken || hasInjectedScriptMarker)) {
                addDetected(fallbackLabel || "Browser Extension Injector", true);
                addUserscriptSource(text);
            }

            if (allowWeakTokens) {
                for (const ext of KNOWN_GAME_EDITING_EXTENSIONS) {
                    if (ext.tokens.some((token) => text.includes(token))) {
                        addDetected(ext.label, false);
                    }
                }
            }
        };

        const win = typeof window !== "undefined" ? window : null;
        const doc = typeof document !== "undefined" ? document : null;
        const userscriptSources = [];
        const addUserscriptSource = (value) => {
            const source = String(value || "").trim();
            if (!source) return;
            if (!userscriptSources.includes(source)) {
                userscriptSources.push(source);
            }
        };

        if (win && win.__WARHEX_UNAUTHORIZED_EXTENSION_DETECTED__) {
            addDetected("Early extension/userscript marker", true);
            const earlySources = Array.isArray(win.__WARHEX_UNAUTHORIZED_EXTENSION_SOURCES__)
                ? win.__WARHEX_UNAUTHORIZED_EXTENSION_SOURCES__
                : [];
            for (const source of earlySources) {
                addUserscriptSource(source);
            }
        }

        if (win) {
            const userscriptAPIKeys = [
                "GM",
                "GM_info",
                "GM_addStyle",
                "GM_xmlhttpRequest",
                "GM_registerMenuCommand",
                "unsafeWindow"
            ];
            if (userscriptAPIKeys.some((key) => typeof win[key] !== "undefined")) {
                addDetected("Userscript API", true);
            }

            if (typeof win.GM_info !== "undefined") {
                addDetected("Userscript API", true);
                inspectTextForExtension(win.GM_info?.script?.name || "");
                inspectTextForExtension(win.GM_info?.scriptHandler || "");
            }

            const userscriptManagerMarkers = [
                "__violentmonkey",
                "__violentmonkey_proxy",
                "__tampermonkey",
                "__greasemonkey"
            ];
            if (userscriptManagerMarkers.some((key) => typeof win[key] !== "undefined")) {
                addDetected("UserScript Manager", true);
            }

            const runtimeUserscriptSources = Array.isArray(win.__WARHEX_USERSCRIPT_SOURCES__)
                ? win.__WARHEX_USERSCRIPT_SOURCES__
                : [];
            if (runtimeUserscriptSources.length > 0) {
                addDetected("UserScript (*.user.js)", true);
                runtimeUserscriptSources.forEach((source) => addUserscriptSource(source));
            }

            const globalKeys = Object.keys(win);
            for (const key of globalKeys) {
                inspectTextForExtension(key, "", false);
            }

            if (typeof win.performance?.getEntriesByType === "function") {
                const resources = win.performance.getEntriesByType("resource") || [];
                const maxScan = Math.min(resources.length, 250);
                for (let i = 0; i < maxScan; i++) {
                    inspectTextForExtension(resources[i]?.name, "Browser Extension Resource", false);
                }
            }
        }

        if (doc) {
            const nodes = doc.querySelectorAll("script,link,style,iframe");
            nodes.forEach((node) => {
                inspectTextForExtension(node.src || "");
                inspectTextForExtension(node.href || "");
                inspectTextForExtension(node.id || "", "", false);
                inspectTextForExtension(node.className || "", "", false);
                if (node && node.attributes && node.attributes.length > 0) {
                    for (let i = 0; i < node.attributes.length; i++) {
                        const attr = node.attributes[i];
                        inspectTextForExtension(attr?.name || "", "", false);
                        inspectTextForExtension(attr?.value || "", "", false);
                    }
                }
            });
        }

        const blocked = strongDetected.size > 0 || weakDetected.size >= 2;
        const detected = new Set([...strongDetected, ...weakDetected]);

        return {
            blocked,
            detectedExtensions: Array.from(detected),
            userScriptSources: userscriptSources,
        };
    }

    showUnauthorizedExtensionBlock (scan = null) {
        const detected = Array.isArray(scan?.detectedExtensions) ? scan.detectedExtensions : [];
        const source = Array.isArray(scan?.userScriptSources) ? scan.userScriptSources[0] : "";
        const detectedText = detected.length > 0
            ? detected.join(", ")
            : "userscript/modification injector";
        const commonList = this.getKnownEditingExtensionCatalog().join(", ");
        const sourceLine = source
            ? `Source sample: <b>${String(source).slice(0, 110)}</b>`
            : "Turn it off, reload the page, and try again.";

        this.core?.uiManager?.showMenuDialog(
            "Unauthorized Extension Detected",
            `Game start blocked. Detected: ${detectedText}.`,
            "Disable any script/CSS editing extension before joining.",
            `Common extension family list: <b>${commonList}</b>.`,
            "Understood",
            sourceLine
        );
        this.core?.setGameplayActive?.(false);
    }

    // Join the game by sending a join message to the server
    joinGame (playerName, equippedSkin) {
        if (this.enforceStrictClientSecurity && this.unauthorizedExtensionDetected) {
            this.showUnauthorizedExtensionBlock({
                blocked: true,
                detectedExtensions: ["UserScript/Extension runtime"],
                userScriptSources: [],
            });
            return false;
        }

        if (this.enforceStrictClientSecurity && this.securityViolationReported) {
            this.showSecurityViolationDialog(this.securityViolationReason || SECURITY_ALERT_REASON.DEVTOOLS_SHORTCUT);
            return false;
        }

        const scan = this.scanJoinEnvironmentForUnauthorizedExtensions();
        let preferredColorIndex = Number(localStorage.getItem("defaultColorIndex")) || 0;
        preferredColorIndex = Math.max(0, Math.min(127, preferredColorIndex));
        if (scan.blocked) {
            if (this.enforceStrictClientSecurity) {
                this.handleUnauthorizedExtensionDetected(scan);
                return false;
            } else {
                this.pendingUnauthorizedJoinBlockNotice = false;
                this.core?.uiManager?.addChatMessage(
                    "System",
                    "Potential script/CSS extension detected. For fair play and fewer bugs, disable browser modifiers while playing.",
                    "#ffcc66"
                );
            }
        } else {
            this.pendingUnauthorizedJoinBlockNotice = false;
        }

        const fingerprint = this.getFingerPrint();
        // Keep compatibility with backend join-security bit when strict mode is active.
        if (this.enforceStrictClientSecurity && scan.blocked) {
            preferredColorIndex |= JOIN_SECURITY_FLAG_UNAUTHORIZED_EXTENSION;
        }
        const message = Message.createJoinMessage(playerName, equippedSkin, preferredColorIndex, fingerprint);
        this.sendMessage(message);
        return true;
    }

    placeBuilding (buildingType, position, isDefenseAction = false, placementRotationStep = 0) {
        const message = Message.createPlaceBuildingMessage(
            buildingType,
            position,
            isDefenseAction,
            placementRotationStep
        );
        this.sendMessage(message);
    }

    chunkBuildingIDs (buildingIDs, maxPerMessage = 40) {
        if (!Array.isArray(buildingIDs) || buildingIDs.length === 0) {
            return [];
        }
        const normalized = [...new Set(
            buildingIDs
                .map((id) => Number(id))
                .filter((id) => Number.isInteger(id) && id >= 0 && id <= 255)
        )];
        if (normalized.length === 0) {
            return [];
        }
        const chunkSize = Math.max(1, Number(maxPerMessage) || 40);
        const chunks = [];
        for (let i = 0; i < normalized.length; i += chunkSize) {
            chunks.push(normalized.slice(i, i + chunkSize));
        }
        return chunks;
    }

    upgradeBuildings (buildingIDs, buildingVariant, neutralBaseID = null) {
        const chunks = this.chunkBuildingIDs(buildingIDs, 40);
        chunks.forEach((chunk) => {
            const message = Message.createUpgradeBuildingsMessage(chunk, buildingVariant, neutralBaseID);
            this.sendMessage(message);
        });
    }

    removeBuildings (buildingIDs, neutralBaseID = null) {
        const chunks = this.chunkBuildingIDs(buildingIDs, 40);
        chunks.forEach((chunk) => {
            const message = Message.createRemoveBuildingsMessage(chunk, neutralBaseID);
            this.sendMessage(message);
        });
    }

    moveUnits (units, targetPosition) {
        const message = Message.createMoveUnitsMessage(units, targetPosition);
        this.sendMessage(message);
    }

    toggleUnitSpawning (barracksID, neutralBaseID = null) {
        const message = Message.createToggleUnitSpawning(barracksID, neutralBaseID);
        this.sendMessage(message);
    }

    sendCameraUpdate (position, zoomLevel) {
        const message = Message.createCameraUpdateMessage(position, zoomLevel);
        this.sendMessage(message);
    }

    sendBuyCommander () {
        const message = Message.createBuyCommanderMessage();
        this.sendMessage(message);
    }

    sendBuyRepair () {
        const message = Message.createBuyRepairMessage();
        this.sendMessage(message);
    }

    sendBuyRelocateBase (position = null) {
        const message = Message.createBuyRelocateBaseMessage(position);
        this.sendMessage(message);
    }

    sendChatMessage (text) {
        const message = Message.createChatMessageMessage(text);
        this.sendMessage(message);
    }

    sendPlayerActivity() {
        const message = Message.createPlayerActivityMessage();
        this.sendMessage(message);
    }

    sendToggleGroupUnits(isGrouped) {
        const message = Message.createToggleGroupUnitsMessage(isGrouped);
        this.sendMessage(message);
    }

    sendX1Challenge(targetPlayerID) {
        const message = Message.createSendX1ChallengeMessage(targetPlayerID);
        this.sendMessage(message);
    }

    sendX1ChallengeResponse(challengerPlayerID, accepted) {
        const message = Message.createX1ChallengeResponseMessage(challengerPlayerID, accepted);
        this.sendMessage(message);
    }

    sendWatchLeaveBase(targetPlayerID) {
        const message = Message.createWatchLeaveBaseMessage(targetPlayerID);
        this.sendMessage(message);
    }

    handlePlayerInactiveWarning() {
        this.core.uiManager.showInactivityWarning();
    }

    handlePlayerActive() {
        this.core.uiManager.hideInactivityWarning();
    }

    handleX1ChallengeReceived(payload) {
        const { challengerID, challengerName } = payload;
        this.core.uiManager.showX1ChallengePrompt(
            challengerName,
            () => this.sendX1ChallengeResponse(challengerID, true),
            () => this.sendX1ChallengeResponse(challengerID, false)
        );
    }

    handleX1ChallengeResult(payload) {
        const { status, playerName, playerID, arena, prepSeconds } = payload;
        const opponent = playerName || "Player";

        switch (status) {
            case 0:
                this.core.uiManager.addChatMessage("System", `X1 challenge sent to ${opponent}.`, "#60c1ff");
                break;
            case 1:
                this.core.uiManager.addChatMessage(
                    "System",
                    `X1 accepted by ${opponent}. Protected arena active${prepSeconds ? ` (${prepSeconds}s setup)` : ""}.`,
                    "#7CFC00"
                );
                if (arena) {
                    this.core.gameManager.setDuelArena(arena, playerID);
                    const localID = this.core.gameManager.getCurrentPlayerId();
                    if (localID) {
                        this.core.gameManager.upsertGlobalDuelArena(localID, playerID, arena);
                    }
                }
                this.core.uiManager.showX1DuelStatus(opponent, prepSeconds || 0);
                break;
            case 2:
                this.core.uiManager.addChatMessage("System", `X1 challenge with ${opponent} was declined.`, "#ff7b7b");
                break;
            case 3:
                this.core.uiManager.addChatMessage("System", "X1 works only with your immediate left/right neighbor.", "#ffcc66");
                break;
            case 4:
                this.core.uiManager.addChatMessage("System", "This player is unavailable for X1 right now.", "#ffcc66");
                break;
            case 5:
                this.core.uiManager.addChatMessage("System", "No pending X1 challenge found.", "#ffcc66");
                break;
            case 6:
                this.core.uiManager.addChatMessage("System", "Leave your base protection area before sending an X1 challenge.", "#ffcc66");
                break;
            case 7:
                this.core.uiManager.addChatMessage("System", "This player was attacked recently. Try X1 again in a few minutes.", "#ffcc66");
                break;
            case 8:
                this.core.uiManager.addChatMessage("System", `${opponent} enabled a notification for when you leave your base.`, "#60c1ff");
                break;
            default:
                this.core.uiManager.addChatMessage("System", "Could not process X1 challenge.", "#ffcc66");
                break;
        }
    }

    handleX1DuelArenaUpdate(payload) {
        const { playerAID, playerBID, arena } = payload;
        if (!arena) return;
        this.core.gameManager.upsertGlobalDuelArena(playerAID, playerBID, arena);
    }

    sendResyncRequest () {
        const message = Message.createRequestResyncMessage();
        this.sendMessage(message);
    }

    sendSkinDataRequest () {
        const message = Message.createRequestSkinDataMessage();
        this.sendMessage(message);
    }

    getFingerPrint () {
        const hashString = (str) => {
            let hash = 5381;
            for (let i = 0; i < str.length; i++) {
                hash = (hash * 33) ^ str.charCodeAt(i);
            }
            return hash >>> 0; // Ensure positive integer result
        }

        const userAgent = navigator.userAgent;
        const screenResolution = `${screen.width}x${screen.height}`;
        const timezone = new Date().getTimezoneOffset();
        const language = navigator.language || navigator.userLanguage;
        const colorDepth = screen.colorDepth;
        const cpuClass = navigator.hardwareConcurrency || 'unknown';

        // Concatenate collected properties into a single string
        const fingerprintData = `${userAgent}||${screenResolution}||${timezone}||${language}||${colorDepth}||${cpuClass}`;

        return hashString(fingerprintData);
    }
}
