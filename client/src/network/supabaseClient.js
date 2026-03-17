import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sbwotyhotmthlmtysltl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNid290eWhvdG10aGxtdHlzbHRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Njg1NDczNSwiZXhwIjoyMDgyNDMwNzM1fQ.M5na5xG06z_PptrSK5Uxgx9aKN4n7lBB3F6k2JEiST8';
const SUPABASE_CLIENT_PATCH_VERSION = "2026-03-15-rank-bases-fix-v3";

if (typeof window !== "undefined") {
    window.__warhexSupabasePatchVersion = SUPABASE_CLIENT_PATCH_VERSION;
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Callback exchange is handled explicitly in consumeOAuthCallbackSession().
        detectSessionInUrl: false,
        // Prevent Browser LockManager timeouts in environments with duplicated init/reload.
        multiTab: false,
        // Avoid deadlocks/orphaned auth locks blocking non-auth requests.
        lock: async (_name, _acquireTimeout, fn) => await fn()
    }
});

const LOCAL_SESSION_KEY = 'blobl_supabase_session';
const SKINS_CACHE_TTL_MS = 10 * 60 * 1000;
const LEADERBOARD_CACHE_TTL_MS = 15 * 1000;
const MUSIC_CACHE_TTL_MS = 60 * 1000;
const STORAGE_LIST_PAGE_SIZE = 100;
const STORAGE_LIST_MAX_REQUESTS = 20;
const GLOBAL_RANK_CACHE_KEY = "warhex_global_rank_cache_v1";
const PUBLIC_BASES_CACHE_KEY = "warhex_public_bases_cache_v1";
const BASE_LAYOUTS_VISIBILITY_PREF_KEY = "warhex_base_layout_visibility_pref_v1";
const MUSIC_BUCKET = "music";

let skinsCache = {
    data: [],
    fetchedAt: 0,
    inFlight: null
};

let leaderboardCache = {
    key: "",
    data: [],
    fetchedAt: 0,
    inFlight: null
};

let musicCache = {
    data: [],
    fetchedAt: 0,
    inFlight: null
};

export function invalidateGlobalLeaderboardCache() {
    leaderboardCache = {
        key: "",
        data: [],
        fetchedAt: 0,
        inFlight: null
    };
    try {
        localStorage.removeItem(GLOBAL_RANK_CACHE_KEY);
    } catch {}
}

function readCachedJson(key, fallbackValue) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallbackValue;
        const parsed = JSON.parse(raw);
        return parsed ?? fallbackValue;
    } catch {
        return fallbackValue;
    }
}

function writeCachedJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {}
}

function readPreferredVisibilityColumn() {
    try {
        const raw = String(localStorage.getItem(BASE_LAYOUTS_VISIBILITY_PREF_KEY) || "").trim();
        if (raw === "is_public" || raw === "public" || raw === "none") {
            return raw;
        }
    } catch {}
    return "";
}

function writePreferredVisibilityColumn(columnName = null) {
    try {
        const value = columnName === "is_public" || columnName === "public" ? columnName : "none";
        localStorage.setItem(BASE_LAYOUTS_VISIBILITY_PREF_KEY, value);
    } catch {}
}

function isTransientSupabaseError(error) {
    const status = Number(error?.status || error?.code || 0);
    const message = String(error?.message || "").toLowerCase();
    if (status === 429 || status === 503 || status === 504) return true;
    return message.includes("too many")
        || message.includes("timeout")
        || message.includes("temporarily unavailable")
        || message.includes("connection");
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryWithBackoff(operation, {
    retries = 2,
    initialDelayMs = 400
} = {}) {
    let attempt = 0;
    let waitMs = initialDelayMs;
    let lastError = null;

    while (attempt <= retries) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt === retries || !isTransientSupabaseError(error)) {
                throw error;
            }
            await delay(waitMs);
            waitMs *= 2;
            attempt += 1;
        }
    }

    throw lastError;
}

function clearSupabaseAuthKeys(storage) {
    if (!storage) return;
    try {
        const keysToRemove = [];
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key && /^sb-.*-auth-token$/.test(key)) {
                keysToRemove.push(key);
            }
        }
        for (const key of keysToRemove) {
            storage.removeItem(key);
        }
    } catch (e) {
        console.warn("Could not clear Supabase auth keys from storage:", e);
    }
}

export function clearLocalAuthState() {
    try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch (e) { }
    clearSupabaseAuthKeys(localStorage);
    clearSupabaseAuthKeys(sessionStorage);
}

// Auth functions
export async function signUp(email, password, nickname) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPassword = String(password || "");
    const normalizedNickname = String(nickname || "").trim();
    if (!normalizedEmail || !normalizedPassword || !normalizedNickname) {
        throw new Error("Email, nickname and password are required.");
    }

    const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: normalizedPassword,
        options: {
            data: {
                nickname: normalizedNickname
            }
        }
    });
    if (error) throw error;
    return data;
}

export async function resendSignupConfirmation(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) {
        throw new Error("Email is required.");
    }
    const { data, error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail
    });
    if (error) throw error;
    return data;
}

export async function signIn(email, password) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedPassword = String(password || "");
    if (!normalizedEmail || !normalizedPassword) {
        throw new Error("Email and password are required.");
    }

    console.log('Attempting sign in with email:', normalizedEmail);
    const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password: normalizedPassword
    });
    if (error) {
        console.error('Sign in error:', error);
        throw error;
    }
    console.log('Sign in successful:', data);
    try {
        // Persist session to localStorage as a fallback
        if (data && data.session) {
            localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(data.session));
        }
    } catch (e) {
        console.warn('Could not persist session to localStorage:', e);
    }
    return data;
}

export async function signInWithDiscord() {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: {
            redirectTo,
            scopes: "identify email",
            // Keep control in UI so we can surface friendly errors before navigation.
            skipBrowserRedirect: true
        }
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Missing Discord OAuth URL.");
    if (typeof window !== "undefined") {
        window.location.assign(data.url);
    }
    return data;
}

export async function signInWithGoogle() {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
            redirectTo,
            // Keep control in UI so we can surface friendly errors before navigation.
            skipBrowserRedirect: true,
            // Force Google account chooser so user can pick which email to use.
            queryParams: {
                prompt: "select_account"
            }
        }
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Missing Google OAuth URL.");
    if (typeof window !== "undefined") {
        window.location.assign(data.url);
    }
    return data;
}

export async function updateAuthNickname(nickname) {
    const cleanNickname = String(nickname || "").trim();
    if (!cleanNickname) throw new Error("Nickname is required.");
    const { data, error } = await supabase.auth.updateUser({
        data: {
            nickname: cleanNickname
        }
    });
    if (error) throw error;
    return data;
}

function deriveNicknameFromAuthUser(authUser, preferredNickname = "") {
    const normalize = (value) => String(value || "")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .slice(0, 20);

    const resolveAuthEmail = (user) => {
        const directEmail = user?.email || user?.user_metadata?.email || user?.raw_user_meta_data?.email || "";
        if (directEmail) return String(directEmail).trim();

        const identities = Array.isArray(user?.identities) ? user.identities : [];
        for (const identity of identities) {
            const providerEmail = identity?.email || identity?.identity_data?.email || "";
            if (providerEmail) return String(providerEmail).trim();
        }
        return "";
    };

    const candidates = [
        preferredNickname,
        authUser?.user_metadata?.nickname,
        authUser?.user_metadata?.preferred_username,
        authUser?.user_metadata?.user_name,
        authUser?.user_metadata?.full_name,
        authUser?.user_metadata?.name,
        resolveAuthEmail(authUser).split("@")[0],
        "Player"
    ];

    for (const candidate of candidates) {
        const value = normalize(candidate);
        if (value.length >= 3) return value;
    }
    return "Player";
}

function resolveAuthEmail(authUser) {
    const directEmail = authUser?.email || authUser?.user_metadata?.email || authUser?.raw_user_meta_data?.email || "";
    if (directEmail) return String(directEmail).trim();

    const identities = Array.isArray(authUser?.identities) ? authUser.identities : [];
    for (const identity of identities) {
        const providerEmail = identity?.email || identity?.identity_data?.email || "";
        if (providerEmail) return String(providerEmail).trim();
    }
    return "";
}

function resolveDiscordProfile(authUser) {
    const identities = Array.isArray(authUser?.identities) ? authUser.identities : [];
    const discordIdentity = identities.find((identity) => String(identity?.provider || "").toLowerCase() === "discord");

    const appProvider = String(authUser?.app_metadata?.provider || "").toLowerCase();
    const appProviders = Array.isArray(authUser?.app_metadata?.providers) ? authUser.app_metadata.providers.map((p) => String(p || "").toLowerCase()) : [];
    let pendingProvider = "";
    try {
        pendingProvider = String(localStorage.getItem("warhex_oauth_pending_provider") || "").toLowerCase();
    } catch (e) {}
    const hasDiscord = Boolean(discordIdentity) || appProvider === "discord" || appProviders.includes("discord") || pendingProvider === "discord";
    if (!hasDiscord) return null;

    const identityData = discordIdentity?.identity_data || {};
    const metadata = authUser?.user_metadata || {};
    const rawMeta = authUser?.raw_user_meta_data || {};

    const discordId = String(
        identityData?.provider_id
        || identityData?.sub
        || discordIdentity?.id
        || metadata?.provider_id
        || rawMeta?.provider_id
        || ""
    ).trim();
    const username = String(
        identityData?.username
        || identityData?.preferred_username
        || metadata?.preferred_username
        || metadata?.user_name
        || metadata?.name
        || metadata?.full_name
        || ""
    ).trim();
    const globalName = String(identityData?.global_name || metadata?.global_name || "").trim();
    const avatarUrl = String(identityData?.avatar_url || metadata?.avatar_url || rawMeta?.avatar_url || "").trim();
    const email = resolveAuthEmail(authUser);

    return {
        id: discordId || null,
        username: username || globalName || null,
        global_name: globalName || null,
        avatar_url: avatarUrl || null,
        email: email || null,
        linked_at: new Date().toISOString()
    };
}

function normalizeUserRow(row = {}) {
    const statistics = {
        ...(row.statistics || {}),
        highscore: Number(row.highscore ?? row.statistics?.highscore ?? 0),
        kills: Number(row.total_kills ?? row.statistics?.kills ?? 0),
        playtime: Number(row.playtime ?? row.statistics?.playtime ?? 0)
    };
    const progression = {
        ...(row.progression || {}),
        level: Number(row.level ?? row.progression?.level ?? 1),
        xp: Number(row.xp ?? row.progression?.xp ?? 0)
    };
    return {
        ...row,
        statistics,
        progression
    };
}

function cleanupOAuthParamsFromCurrentUrl() {
    if (typeof window === "undefined") return;
    try {
        const url = new URL(window.location.href);
        const queryKeys = [
            "code",
            "state",
            "error",
            "error_description",
            "provider_token",
            "provider_refresh_token"
        ];

        let changed = false;
        queryKeys.forEach((key) => {
            if (url.searchParams.has(key)) {
                url.searchParams.delete(key);
                changed = true;
            }
        });

        if (url.hash && url.hash.length > 1) {
            const rawHash = url.hash.slice(1);
            const hashParams = new URLSearchParams(rawHash);
            const hashKeys = [
                "access_token",
                "refresh_token",
                "expires_at",
                "expires_in",
                "token_type",
                "provider_token",
                "provider_refresh_token",
                "error",
                "error_description"
            ];
            hashKeys.forEach((key) => {
                if (hashParams.has(key)) {
                    hashParams.delete(key);
                    changed = true;
                }
            });
            const rebuiltHash = hashParams.toString();
            url.hash = rebuiltHash ? `#${rebuiltHash}` : "";
        }

        if (!changed) return;
        const cleanUrl = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, document.title, cleanUrl);
    } catch (e) {
        console.warn("Could not cleanup OAuth params from URL:", e);
    }
}

function storeOAuthLastError(message = "") {
    try {
        const text = String(message || "").trim();
        if (!text) {
            localStorage.removeItem("warhex_oauth_last_error");
            return;
        }
        localStorage.setItem("warhex_oauth_last_error", text);
    } catch (e) {}
}

export async function consumeOAuthCallbackSession() {
    if (typeof window === "undefined") {
        return { consumed: false, session: null, error: null };
    }

    try {
        const url = new URL(window.location.href);
        const hashParams = new URLSearchParams((url.hash || "").startsWith("#") ? url.hash.slice(1) : "");
        const oauthError = url.searchParams.get("error");
        const oauthErrorDescription = url.searchParams.get("error_description");
        const hashError = hashParams.get("error");
        const hashErrorDescription = hashParams.get("error_description");
        if (oauthError || hashError) {
            const message = oauthErrorDescription || oauthError || hashErrorDescription || hashError || "OAuth error";
            storeOAuthLastError(message);
            cleanupOAuthParamsFromCurrentUrl();
            return {
                consumed: true,
                session: null,
                error: new Error(message)
            };
        }

        // Handle implicit OAuth callback (#access_token=...&refresh_token=...)
        const hashAccessToken = hashParams.get("access_token");
        const hashRefreshToken = hashParams.get("refresh_token");
        if (hashAccessToken && hashRefreshToken && typeof supabase?.auth?.setSession === "function") {
            const { data, error } = await supabase.auth.setSession({
                access_token: hashAccessToken,
                refresh_token: hashRefreshToken
            });
            cleanupOAuthParamsFromCurrentUrl();

            if (error) {
                storeOAuthLastError(error?.message || "OAuth session setup failed.");
                return { consumed: true, session: null, error };
            }

            const session = data?.session || null;
            storeOAuthLastError("");
            try {
                if (session) {
                    localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
                }
            } catch (e) {
                console.warn("Could not persist OAuth session to localStorage:", e);
            }
            return { consumed: true, session, error: null };
        }

        const code = url.searchParams.get("code");
        if (!code || typeof supabase?.auth?.exchangeCodeForSession !== "function") {
            return { consumed: false, session: null, error: null };
        }

        // If session already exists, avoid exchanging the same OAuth code again.
        try {
            const { data: existingSessionData } = await supabase.auth.getSession();
            if (existingSessionData?.session?.user?.id) {
                cleanupOAuthParamsFromCurrentUrl();
                storeOAuthLastError("");
                return { consumed: true, session: existingSessionData.session, error: null };
            }
        } catch (e) {}

        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        cleanupOAuthParamsFromCurrentUrl();

        if (error) {
            storeOAuthLastError(error?.message || "OAuth exchange failed.");
            return { consumed: true, session: null, error };
        }

        const session = data?.session || null;
        storeOAuthLastError("");
        try {
            if (session) {
                localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
            }
        } catch (e) {
            console.warn("Could not persist OAuth session to localStorage:", e);
        }

        return { consumed: true, session, error: null };
    } catch (error) {
        return { consumed: false, session: null, error };
    }
}

export async function ensureUserRow(authUser, preferredNickname = "") {
    try {
        const userId = authUser?.id;
        if (!userId) return { success: false, error: "missing_user_id", data: null };

        const nickname = deriveNicknameFromAuthUser(authUser, preferredNickname);
        const resolvedEmail = resolveAuthEmail(authUser) || `${userId}@oauth.local`;
        const discordProfile = resolveDiscordProfile(authUser);
        const discordPayload = discordProfile ? { discord: discordProfile } : {};
        const usernameBase = `${nickname}_${String(userId).slice(0, 6)}`.replace(/[^a-zA-Z0-9_]/g, "");
        const payloadCandidates = [
            // Rich payload (for newer schemas)
            {
                id: userId,
                email: resolvedEmail,
                nickname,
                username: usernameBase.slice(0, 20),
                ...discordPayload,
                highscore: 0,
                total_kills: 0,
                playtime: 0,
                level: 1,
                xp: 0,
                coins: 0,
                selected_skin: 0,
                progression: { level: 1, xp: 0 },
                statistics: { highscore: 0, kills: 0, playtime: 0 },
                skins: { equipped: 0, unlocked: [0] }
            },
            // Common payload (legacy schemas)
            {
                id: userId,
                email: resolvedEmail,
                nickname,
                ...discordPayload,
                highscore: 0,
                total_kills: 0,
                playtime: 0,
                progression: { level: 1, xp: 0 },
                statistics: { highscore: 0, kills: 0, playtime: 0 }
            },
            // Minimal payload (guarantee core identity fields)
            {
                id: userId,
                email: resolvedEmail,
                nickname,
                ...discordPayload
            },
            // Absolute fallback if email column is absent/not writable
            {
                id: userId,
                nickname
            }
        ];

        let lastError = null;
        for (const payload of payloadCandidates) {
            const { error } = await supabase
                .from("users")
                // Ignore existing rows to avoid overwriting progression/stats on every login.
                .upsert(payload, { onConflict: "id", ignoreDuplicates: true });

            if (!error) {
                // Row may already exist (ignored duplicate). Read current row once.
                const { data: existingRow, error: existingError } = await supabase
                    .from("users")
                    .select("*")
                    .eq("id", userId)
                    .maybeSingle();
                if (!existingError && existingRow) {
                    return { success: true, data: normalizeUserRow(existingRow) };
                }
                return { success: true, data: normalizeUserRow({ id: userId, email: resolvedEmail, nickname }) };
            }

            lastError = error;
        }

        console.error("Error ensuring user row:", lastError);
        return { success: false, error: lastError, data: null };
    } catch (error) {
        console.error("Error in ensureUserRow:", error);
        return { success: false, error, data: null };
    }
}

export async function signOut() {
    let authError = null;
    try {
        // Local scope guarantees client-side session cleanup even if revoke fails remotely.
        const signOutResult = await withTimeoutPromise(
            supabase.auth.signOut({ scope: "local" }),
            1800,
            "signout_timeout"
        );
        const { error } = signOutResult || {};
        if (error) authError = error;
    } catch (error) {
        const isTimeout = String(error?.message || "").toLowerCase().includes("signout_timeout");
        if (!isTimeout) {
            authError = error;
        }
    } finally {
        clearLocalAuthState();
    }
    if (authError) throw authError;
}

export async function getCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

export async function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
}

// Try to restore session from our localStorage fallback. Useful on reload when
// supabase.auth.getSession() may return null briefly.
export async function restoreSessionFromStorage() {
    try {
        const raw = localStorage.getItem(LOCAL_SESSION_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session || (!session.access_token && !session.refresh_token)) return null;
        if (session.access_token && isAuthTokenExpired(session.access_token)) {
            clearLocalAuthState();
            return null;
        }
        // setSession accepts an object with access_token and refresh_token
        const { data, error } = await supabase.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token
        });
        if (error) {
            const message = String(error?.message || "").toLowerCase();
            if (
                message.includes("expired")
                || message.includes("invalid jwt")
                || message.includes("refresh token")
            ) {
                clearLocalAuthState();
            } else {
                console.error('Error restoring session via setSession:', error);
            }
            return null;
        }
        return data.session || null;
    } catch (e) {
        console.error('Error in restoreSessionFromStorage:', e);
        return null;
    }
}

// Recursively list all files in a Supabase storage bucket (supports nested folders)
async function listAllStorageFiles(bucketName = "skins", prefix = '', state = { requests: 0 }) {
    if (state.requests >= STORAGE_LIST_MAX_REQUESTS) {
        return [];
    }

    const pageSize = STORAGE_LIST_PAGE_SIZE;
    const files = [];
    let page = 0;

    while (true) {
        if (state.requests >= STORAGE_LIST_MAX_REQUESTS) {
            break;
        }

        state.requests += 1;
        const { data, error } = await retryWithBackoff(() => supabase.storage.from(bucketName).list(prefix, {
            limit: pageSize,
            offset: page * pageSize,
            sortBy: { column: 'name', order: 'asc' }
        }));

        if (error) {
            throw error;
        }

        if (!data || data.length === 0) {
            break;
        }

        for (const entry of data) {
            const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const isFile = (entry.metadata && typeof entry.metadata.size === 'number') || /\.[^.]+$/.test(entry.name);
            if (isFile) {
                files.push({ ...entry, fullPath });
            } else {
                // Treat as folder and recurse
                const nested = await listAllStorageFiles(bucketName, fullPath, state);
                files.push(...nested);
            }
        }

        if (data.length < pageSize) {
            break;
        }
        page += 1;
    }

    return files;
}

// Function to fetch skins from Supabase storage bucket (PNG and SVG, nested folders supported)
export async function fetchSkins() {
    const now = Date.now();
    if (skinsCache.data.length > 0 && (now - skinsCache.fetchedAt) < SKINS_CACHE_TTL_MS) {
        return skinsCache.data;
    }

    if (skinsCache.inFlight) {
        return skinsCache.inFlight;
    }

    skinsCache.inFlight = (async () => {
    try {
        const files = await listAllStorageFiles("skins", '');

        // Filter only PNG or SVG files, sort alphabetically (by base name), and create skin objects with URLs
        const skins = files
            .filter(file => /\.(png|svg)$/i.test(file.fullPath))
            .map(file => {
                const skinName = file.fullPath.replace(/\.(png|svg)$/i, '').split('/').pop();
                return { file, skinName };
            })
            .sort((a, b) => a.skinName.localeCompare(b.skinName))
            .map(({ file, skinName }) => {
                const publicUrl = supabase.storage.from('skins').getPublicUrl(file.fullPath).data.publicUrl;
                const extension = (file.fullPath.match(/\.(png|svg)$/i) || [])[0] || '';
                return {
                    id: skinName,
                    name: skinName,
                    url: publicUrl,
                    extension: extension.replace('.', '').toLowerCase(),
                    category: 'default',
                    unlocked: true,
                    requiredLevel: 0,
                    price: 0,
                    isPurchasable: false
                };
            });

        console.log('Fetched skins from storage:', skins.length, 'files');
        skinsCache = {
            ...skinsCache,
            data: skins,
            fetchedAt: Date.now()
        };
        return skins;
    } catch (error) {
        console.error('Error in fetchSkins:', error);
        if (skinsCache.data.length > 0) {
            return skinsCache.data;
        }
        return [];
    } finally {
        skinsCache.inFlight = null;
    }
    })();

    return skinsCache.inFlight;
}

export async function fetchGameMusicTracks(limit = 40) {
    const now = Date.now();
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 40));
    if (musicCache.data.length > 0 && (now - musicCache.fetchedAt) < MUSIC_CACHE_TTL_MS) {
        return { success: true, data: musicCache.data };
    }

    if (musicCache.inFlight) {
        return musicCache.inFlight;
    }

    musicCache.inFlight = (async () => {
        try {
            let tracks = [];
            const normalizePathKey = (value) => String(value || "")
                .trim()
                .replace(/\\/g, "/")
                .replace(/^\/+/, "")
                .toLowerCase();
            const hasAudioExtension = (path) => /\.(mp3|ogg|wav|m4a)$/i.test(String(path || ""));
            let bucketFiles = [];
            try {
                bucketFiles = await listAllStorageFiles(MUSIC_BUCKET, "");
            } catch (storageListError) {
                bucketFiles = [];
            }
            const bucketAudioFiles = bucketFiles
                .filter((file) => hasAudioExtension(file?.fullPath))
                .map((file) => String(file.fullPath || "").trim())
                .filter(Boolean);
            const bucketPathByKey = new Map(bucketAudioFiles.map((path) => [normalizePathKey(path), path]));
            const bucketPathByBaseName = new Map(
                bucketAudioFiles.map((path) => [normalizePathKey(path.split("/").pop()), path])
            );

            // Preferred source: database-managed playlist.
            const { data, error } = await supabase
                .from("game_music_tracks")
                .select("id,title,file_path,volume,sort_order,is_active")
                .eq("is_active", true)
                .order("sort_order", { ascending: true })
                .order("id", { ascending: true })
                .limit(safeLimit);

            if (!error) {
                tracks = (Array.isArray(data) ? data : [])
                    .map((row) => {
                        const rawPath = String(row?.file_path || "").trim();
                        if (!rawPath) return null;

                        let resolvedPath = rawPath;
                        if (bucketAudioFiles.length > 0) {
                            const directMatch = bucketPathByKey.get(normalizePathKey(rawPath));
                            const byNameMatch = bucketPathByBaseName.get(normalizePathKey(rawPath.split("/").pop()));
                            resolvedPath = directMatch || byNameMatch || "";
                            if (!resolvedPath) return null;
                        }

                        const publicUrl = supabase.storage.from(MUSIC_BUCKET).getPublicUrl(resolvedPath)?.data?.publicUrl || "";
                        if (!publicUrl) return null;

                        return {
                            id: Number(row?.id || 0),
                            title: String(row?.title || resolvedPath),
                            filePath: resolvedPath,
                            url: publicUrl,
                            volume: Math.max(0, Math.min(1, Number(row?.volume ?? 0.3) || 0.3)),
                            sortOrder: Number(row?.sort_order || 0)
                        };
                    })
                    .filter(Boolean);
                if (tracks.length > 0) {
                    console.log("Music tracks loaded from DB:", tracks.length);
                }
            }

            // Fallback source: files directly from storage bucket root.
            if (tracks.length === 0) {
                const fallbackPaths = bucketAudioFiles
                    .slice()
                    .sort((a, b) => a.localeCompare(b))
                    .slice(0, safeLimit);

                tracks = fallbackPaths
                    .map((filePath, index) => {
                        const publicUrl = supabase.storage.from(MUSIC_BUCKET).getPublicUrl(filePath)?.data?.publicUrl || "";
                        if (!filePath || !publicUrl) return null;
                        const fileName = filePath.split("/").pop() || filePath;
                        const title = fileName
                            .replace(/\.[^.]+$/, "")
                            .replace(/^\d+\s*/, "")
                            .trim();

                        return {
                            id: index + 1,
                            title: title || filePath,
                            filePath,
                            url: publicUrl,
                            volume: 0.3,
                            sortOrder: index + 1
                        };
                    })
                    .filter(Boolean);
                if (tracks.length > 0) {
                    console.log("Music tracks loaded from storage listing:", tracks.length);
                }
            }

            musicCache = {
                data: tracks,
                fetchedAt: Date.now(),
                inFlight: null
            };
            return { success: true, data: tracks };
        } catch (error) {
            return { success: false, error, data: [] };
        } finally {
            musicCache.inFlight = null;
        }
    })();

    return musicCache.inFlight;
}

// Fetch skins catalog from database (includes level/shop skins)
export async function fetchSkinsCatalog() {
    try {
        const { data, error } = await supabase
            .from('skins')
            .select('*')
            .order('required_level', { ascending: true });
        
        if (error) {
            console.error('Error fetching skins catalog:', error);
            return [];
        }
        
        return data || [];
    } catch (error) {
        console.error('Error in fetchSkinsCatalog:', error);
        return [];
    }
}

// Get user's unlocked skins
export async function getUserUnlockedSkins(userId) {
    try {
        const { data, error } = await supabase
            .from('user_skins')
            .select('skin_name, unlocked_at, unlock_method')
            .eq('user_id', userId);
        
        if (error) {
            console.error('Error fetching user skins:', error);
            return [];
        }
        
        return data || [];
    } catch (error) {
        console.error('Error in getUserUnlockedSkins:', error);
        return [];
    }
}

// Unlock a skin for a user
export async function unlockSkin(userId, skinName, method = 'default') {
    try {
        const { data, error } = await supabase
            .from('user_skins')
            .insert({ 
                user_id: userId, 
                skin_name: skinName, 
                unlock_method: method 
            })
            .select();
        
        if (error) {
            // Ignore duplicate errors (skin already unlocked)
            if (error.code === '23505') {
                console.log('Skin already unlocked:', skinName);
                return { success: true, alreadyUnlocked: true };
            }
            console.error('Error unlocking skin:', error);
            return { success: false, error };
        }
        
        return { success: true, data };
    } catch (error) {
        console.error('Error in unlockSkin:', error);
        return { success: false, error };
    }
}

// Update user's selected skin
export async function updateSelectedSkin(userId, skinName) {
    try {
        const { data, error } = await supabase
            .from('users')
            .update({ selected_skin: skinName })
            .eq('id', userId);
        
        if (error) {
            console.error('Error updating selected skin:', error);
            return { success: false, error };
        }
        
        return { success: true };
    } catch (error) {
        console.error('Error in updateSelectedSkin:', error);
        return { success: false, error };
    }
}

export async function fetchUserRowById(userId) {
    try {
        if (!userId) return { success: false, error: "missing_user_id", data: null };
        const authToken = await getCurrentAccessToken(4200);
        if (!authToken) return { success: false, error: "missing_auth_token", data: null };

        const path = `/rest/v1/users?select=*&id=eq.${encodeURIComponent(userId)}&limit=1`;
        const result = await postgrestRequestWithRetry(path, {
            timeoutMs: 9000,
            authToken
        }, 1);

        if (!result?.ok) {
            return { success: false, error: result?.error || "user_fetch_failed", data: null };
        }

        const row = Array.isArray(result.data) ? (result.data[0] || null) : (result.data || null);
        return { success: Boolean(row), error: row ? null : "user_not_found", data: row };
    } catch (error) {
        return { success: false, error, data: null };
    }
}

// Persist user progression/stats after a round ends.
export async function updateUserProgressStats(userId, progression, statistics) {
    try {
        if (!userId) return { success: false, error: "missing_user_id" };

        const authToken = await getCurrentAccessToken();
        if (!authToken) {
            return { success: false, error: "missing_auth_token" };
        }

        // Keep this payload aligned with the current public.users schema.
        const payload = {
            highscore: Math.max(0, Number(statistics?.highscore ?? statistics?.score ?? 0)),
            total_kills: Math.max(0, Number(statistics?.kills ?? statistics?.total_kills ?? 0)),
            playtime: Math.max(0, Number(statistics?.playtime ?? statistics?.time_played ?? 0))
        };

        // Guard against stale local cache: never send lower lifetime stats than the DB already has.
        try {
            const readPath = `/rest/v1/users?select=highscore,total_kills,playtime&id=eq.${encodeURIComponent(userId)}&limit=1`;
            const currentResult = await postgrestRequestWithRetry(readPath, { timeoutMs: 7000, authToken }, 1);
            if (currentResult?.ok) {
                const currentRow = Array.isArray(currentResult.data) ? currentResult.data[0] : currentResult.data;
                if (currentRow) {
                    payload.highscore = Math.max(payload.highscore, Math.max(0, Number(currentRow.highscore || 0)));
                    payload.total_kills = Math.max(payload.total_kills, Math.max(0, Number(currentRow.total_kills || 0)));
                    payload.playtime = Math.max(payload.playtime, Math.max(0, Number(currentRow.playtime || 0)));
                }
            }
        } catch {}

        const path = `/rest/v1/users?id=eq.${encodeURIComponent(userId)}`;
        const sendPatch = () => postgrestRequestWithRetry(path, {
            method: "PATCH",
            body: payload,
            prefer: "return=representation",
            timeoutMs: 10000,
            authToken
        }, 2);
        let result = await sendPatch();

        // If row is missing (or silently filtered by policy), ensure row once and retry.
        const emptyWrite = result?.ok && Array.isArray(result?.data) && result.data.length === 0;
        if (!result?.ok || emptyWrite) {
            try {
                const authUser = await getCurrentUser();
                if (authUser?.id === userId) {
                    await ensureUserRow(authUser, authUser?.user_metadata?.nickname || "");
                    result = await sendPatch();
                }
            } catch {}
        }

        if (!result?.ok) {
            console.error("Error updating user progression/stats:", result?.error || "unknown_error");
            return { success: false, error: result?.error || "update_failed" };
        }

        return { success: true };
    } catch (error) {
        console.error("Error in updateUserProgressStats:", error);
        return { success: false, error };
    }
}

// Same stats update, but resilient during tab close/reload via keepalive fetch.
export async function updateUserProgressStatsKeepalive(userId, statistics, progression = null) {
    try {
        if (!userId) return { success: false, error: "missing_user_id" };

        const payload = {
            highscore: Math.max(0, Number(statistics?.highscore ?? statistics?.score ?? 0)),
            total_kills: Math.max(0, Number(statistics?.kills ?? statistics?.total_kills ?? 0)),
            playtime: Math.max(0, Number(statistics?.playtime ?? statistics?.time_played ?? 0))
        };

        const authToken = await getCurrentAccessToken(1200);
        const url = `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`;
        const resp = await fetch(url, {
            method: "PATCH",
            keepalive: true,
            headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${authToken || supabaseKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            return { success: false, error: text || resp.statusText || String(resp.status) };
        }

        return { success: true };
    } catch (error) {
        return { success: false, error };
    }
}

// Purchase a skin (deduct coins and unlock)
export async function purchaseSkin(userId, skinName, price) {
    try {
        // First, check if user has enough coins
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('coins')
            .eq('id', userId)
            .single();
        
        if (userError || !userData) {
            return { success: false, error: 'Could not fetch user data' };
        }
        
        if (userData.coins < price) {
            return { success: false, error: 'Not enough coins' };
        }
        
        // Deduct coins
        const { error: coinsError } = await supabase
            .from('users')
            .update({ coins: userData.coins - price })
            .eq('id', userId);
        
        if (coinsError) {
            return { success: false, error: 'Could not deduct coins' };
        }
        
        // Unlock the skin
        const unlockResult = await unlockSkin(userId, skinName, 'purchase');
        if (!unlockResult.success) {
            // Refund coins if unlock failed
            await supabase
                .from('users')
                .update({ coins: userData.coins })
                .eq('id', userId);
            return { success: false, error: 'Could not unlock skin' };
        }
        
        return { success: true, newBalance: userData.coins - price };
    } catch (error) {
        console.error('Error in purchaseSkin:', error);
        return { success: false, error };
    }
}

const BASE_LAYOUTS_TABLE = "base_layouts";
const BASE_LAYOUTS_LIST_FIELDS = "id, name, author_name, snapshot, created_at";
const BASE_LAYOUTS_SELECT_FIELDS = "id, name, author_name, snapshot, created_at, layout_json";

function normalizeBaseLayoutSnapshot(snapshot) {
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

    // Backward compatibility for rows that stored bare base64.
    const compact = value.replace(/\s+/g, "");
    const looksLikeBase64 = compact.length > 120 && /^[A-Za-z0-9+/=]+$/.test(compact);
    if (looksLikeBase64) {
        return `data:image/jpeg;base64,${compact}`;
    }
    return null;
}

async function withTimeoutPromise(promise, ms = 10000, timeoutMessage = "request_timeout") {
    let timeoutId = null;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), ms);
            })
        ]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

async function getCurrentAccessToken(timeoutMs = 2500) {
    const readSessionToken = async (ms = timeoutMs) => {
        try {
            const sessionResult = await withTimeoutPromise(
                supabase.auth.getSession(),
                ms,
                "auth_session_timeout"
            );
            return sessionResult?.data?.session?.access_token || null;
        } catch {
            return null;
        }
    };

    // 1) Fast path: current in-memory/auth session.
    let token = await sanitizeAccessToken(await readSessionToken(timeoutMs));
    if (token) return token;

    // 2) Recovery path: restore from local fallback and retry.
    try {
        const restored = await withTimeoutPromise(
            restoreSessionFromStorage(),
            Math.max(2200, timeoutMs),
            "auth_restore_timeout"
        );
        token = await sanitizeAccessToken(restored?.access_token || null);
        if (token) return token;
    } catch {}

    // 3) Retry getSession once more after restore attempt.
    token = await sanitizeAccessToken(await readSessionToken(Math.max(2200, timeoutMs)));
    if (token) return token;

    // 4) Last-resort fallback from persisted local session.
    try {
        const raw = localStorage.getItem(LOCAL_SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return await sanitizeAccessToken(parsed?.access_token || null);
    } catch {
        return null;
    }
}

async function postgrestRequest(path, {
    method = "GET",
    body = null,
    timeoutMs = 10000,
    prefer = "",
    authToken = null
} = {}) {
    const controller = new AbortController();
    let timeoutId = null;
    try {
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const headers = {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${authToken || supabaseKey}`
        };
        if (body != null) headers["Content-Type"] = "application/json";
        if (prefer) headers["Prefer"] = prefer;

        const response = await fetch(`${supabaseUrl}${path}`, {
            method,
            headers,
            signal: controller.signal,
            body: body == null ? undefined : JSON.stringify(body)
        });
        const rawText = await response.text().catch(() => "");
        let parsed = null;
        try {
            parsed = rawText ? JSON.parse(rawText) : null;
        } catch {
            parsed = null;
        }

        if (!response.ok) {
            const message = parsed?.message || rawText || response.statusText || String(response.status);
            return {
                ok: false,
                status: response.status,
                error: {
                    code: parsed?.code || String(response.status),
                    message,
                    details: parsed?.details || "",
                    hint: parsed?.hint || ""
                }
            };
        }

        return { ok: true, status: response.status, data: parsed };
    } catch (error) {
        const timedOut = error?.name === "AbortError";
        return {
            ok: false,
            status: 0,
            error: {
                code: timedOut ? "request_timeout" : "request_error",
                message: timedOut ? "Request timed out" : String(error?.message || error || "Request failed"),
                details: "",
                hint: ""
            }
        };
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function isTransientRequestError(error) {
    if (!error) return false;
    const code = String(error.code || "").toLowerCase();
    const message = String(error.message || "").toLowerCase();
    const status = Number(error.status || 0);
    return status === 0
        || status === 408
        || status === 429
        || status === 500
        || status === 502
        || status === 503
        || status === 504
        || code === "request_timeout"
        || code === "request_error"
        || message.includes("timeout")
        || message.includes("network");
}

async function postgrestRequestWithRetry(path, options = {}, retries = 2, baseDelayMs = 320) {
    let lastResult = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const result = await postgrestRequest(path, options);
        if (result.ok) return result;
        lastResult = result;
        if (attempt === retries || !isTransientRequestError(result.error)) break;
        const delayMs = baseDelayMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return lastResult || {
        ok: false,
        status: 0,
        error: { code: "request_error", message: "Request failed", details: "", hint: "" }
    };
}

function isRlsDeniedError(error) {
    if (!error) return false;
    const code = String(error.code || "").toUpperCase();
    const message = String(error.message || "").toLowerCase();
    return code === "42501" || message.includes("row-level security");
}

function isMissingColumnError(error, columnName) {
    if (!error || !columnName) return false;
    const code = String(error?.code || "").toUpperCase();
    if (code === "42703") return true;
    const haystack = String(error?.message || error?.details || error?.hint || "").toLowerCase();
    return haystack.includes(String(columnName).toLowerCase());
}

function isMissingTableOrEndpointError(error) {
    if (!error) return false;
    const code = String(error?.code || "").toUpperCase();
    const status = Number(error?.status || 0);
    const message = String(error?.message || "").toLowerCase();
    return code === "42P01"
        || code === "PGRST205"
        || status === 404
        || (message.includes("relation") && message.includes("does not exist"));
}

let lastExpiredAuthCleanupAt = 0;

function isAuthTokenExpired(token, skewSeconds = 30) {
    const payload = decodeJwtPayload(token);
    const exp = Number(payload?.exp || 0);
    if (!Number.isFinite(exp) || exp <= 0) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return nowSeconds >= (exp - Math.max(0, Number(skewSeconds) || 0));
}

async function cleanupExpiredAuthSession() {
    const now = Date.now();
    if ((now - lastExpiredAuthCleanupAt) < 5000) return;
    lastExpiredAuthCleanupAt = now;

    try {
        await withTimeoutPromise(
            supabase.auth.signOut({ scope: "local" }),
            1200,
            "signout_timeout"
        );
    } catch {}
    clearLocalAuthState();
}

async function sanitizeAccessToken(token) {
    if (!token) return null;
    if (!isAuthTokenExpired(token)) return token;
    await cleanupExpiredAuthSession();
    return null;
}

function decodeJwtPayload(token) {
    try {
        const parts = String(token || "").split(".");
        if (parts.length < 2) return null;
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        const raw = atob(padded);
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function getUserIdFromAccessToken(token) {
    const payload = decodeJwtPayload(token);
    const sub = payload?.sub;
    return typeof sub === "string" && sub.trim() ? sub.trim() : null;
}

function buildPublicLayoutsQuery(searchText = "", limit = 30, visibilityColumn = "is_public") {
    let query = supabase
        .from(BASE_LAYOUTS_TABLE)
        .select(BASE_LAYOUTS_LIST_FIELDS);

    if (visibilityColumn) {
        query = query.eq(visibilityColumn, true);
    }

    query = query
        .order("created_at", { ascending: false })
        .limit(Math.max(1, Math.min(100, limit)));

    const term = (searchText || "").trim();
    if (term) {
        query = query.or(`name.ilike.%${term}%,author_name.ilike.%${term}%`);
    }

    return query;
}

async function insertBaseLayout(payload, visibilityColumn, isPublic = true) {
    const insertPayload = { ...payload };
    if (visibilityColumn) {
        insertPayload[visibilityColumn] = Boolean(isPublic);
    }
    let authToken = await getCurrentAccessToken(1800);
    if (!authToken) {
        try {
            const restored = await withTimeoutPromise(
                restoreSessionFromStorage(),
                1800,
                "auth_restore_timeout"
            );
            if (restored?.access_token) {
                authToken = restored.access_token;
            } else {
                authToken = await getCurrentAccessToken(1800);
            }
        } catch {}
    }
    if (!authToken) {
        return {
            data: null,
            error: {
                code: "auth_required",
                message: "Login required to publish base.",
                details: "",
                hint: ""
            }
        };
    }

    // Align with RLS policies that require user_id = auth.uid().
    const tokenUserId = getUserIdFromAccessToken(authToken);
    if (tokenUserId) {
        insertPayload.user_id = tokenUserId;
    }

    const restResult = await postgrestRequestWithRetry(
        `/rest/v1/${BASE_LAYOUTS_TABLE}`,
        {
            method: "POST",
            body: insertPayload,
            timeoutMs: 7000,
            // Avoid requiring immediate SELECT permission on the inserted row.
            prefer: "return=minimal",
            authToken
        },
        0
    );
    if (restResult.ok) {
        return { data: null, error: null };
    }
    return { data: null, error: restResult.error };
}

async function fetchPublicLayoutsWithVisibility(searchText = "", limit = 30, visibilityColumn = "is_public") {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
    const termRaw = (searchText || "").trim();
    const term = termRaw.replace(/[(),]/g, " ").replace(/\s+/g, " ").trim();
    const authToken = await getCurrentAccessToken();

    let path = `/rest/v1/${BASE_LAYOUTS_TABLE}?select=${encodeURIComponent(BASE_LAYOUTS_LIST_FIELDS)}&order=created_at.desc&limit=${safeLimit}`;
    if (visibilityColumn) {
        path += `&${visibilityColumn}=eq.true`;
    }
    if (term) {
        path += `&or=${encodeURIComponent(`(name.ilike.%${term}%,author_name.ilike.%${term}%)`)}`;
    }

    const restResult = await postgrestRequestWithRetry(path, { timeoutMs: 18000, authToken }, 2);
    if (restResult.ok) {
        const rows = Array.isArray(restResult.data) ? restResult.data : [];
        return {
            data: rows.map((row) => ({
                ...row,
                snapshot: normalizeBaseLayoutSnapshot(row?.snapshot)
            })),
            error: null
        };
    }
    return { data: [], error: restResult.error };
}

export async function publishBaseLayout({ userId, authorName, name, snapshot, buildings, isPublic = true }) {
    const runPublish = async () => {
        let resolvedUserId = userId || null;
        let resolvedAuthorName = authorName || "";
        if (!resolvedUserId || !resolvedAuthorName) {
            try {
                const authUser = await withTimeoutPromise(
                    getCurrentUser(),
                    1800,
                    "auth_user_timeout"
                );
                if (!resolvedUserId && authUser?.id) {
                    resolvedUserId = authUser.id;
                }
                if (!resolvedAuthorName) {
                    resolvedAuthorName =
                        authUser?.user_metadata?.nickname
                        || resolveAuthEmail(authUser)?.split("@")[0]
                        || "";
                }
            } catch {}
        }

        const payload = {
            user_id: resolvedUserId || null,
            author_name: resolvedAuthorName || "Guest",
            name: (name || "Unnamed Base").trim(),
            snapshot: normalizeBaseLayoutSnapshot(snapshot) || null,
            layout_json: { buildings: Array.isArray(buildings) ? buildings : [] }
        };

        const preferredRaw = readPreferredVisibilityColumn();
        const preferredColumn = preferredRaw === "none" ? null : preferredRaw;
        const baseAttempts = ["is_public", "public", null];
        const attempts = [
            ...(preferredColumn ? [preferredColumn] : []),
            ...baseAttempts
        ].filter((value, index, self) => self.indexOf(value) === index);
        let lastError = null;

        for (const visibilityColumn of attempts) {
            const { data, error } = await insertBaseLayout(payload, visibilityColumn, isPublic);
            if (!error) {
                writePreferredVisibilityColumn(visibilityColumn);
                try {
                    localStorage.removeItem(PUBLIC_BASES_CACHE_KEY);
                } catch {}
                return { success: true, data };
            }

            lastError = error;
            const canTryNext =
                (visibilityColumn === "is_public" && isMissingColumnError(error, "is_public"))
                || (visibilityColumn === "public" && isMissingColumnError(error, "public"));
            if (canTryNext) continue;
            break;
        }

        if (isRlsDeniedError(lastError)) {
            return {
                success: false,
                error: {
                    code: "publish_forbidden",
                    message: "You do not have permission to publish this base.",
                    details: lastError?.message || "",
                    hint: ""
                }
            };
        }

        console.error("Error publishing base layout:", lastError);
        return { success: false, error: lastError };
    };

    try {
        // Avoid double-timeout races: publish already uses timed REST requests with retries.
        return await runPublish();
    } catch (error) {
        console.error("Error in publishBaseLayout:", error);
        return { success: false, error };
    }
}

export async function fetchPublicBaseLayouts(searchText = "", limit = 30) {
    try {
        const attempts = ["is_public", "public", null];
        let lastError = null;
        const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
        const normalizedSearch = String(searchText || "").trim().toLowerCase();

        for (const visibilityColumn of attempts) {
            const { data, error } = await fetchPublicLayoutsWithVisibility(searchText, safeLimit, visibilityColumn);
            if (!error) {
                const rows = data || [];
                writeCachedJson(PUBLIC_BASES_CACHE_KEY, {
                    rows,
                    fetchedAt: Date.now()
                });
                return { success: true, data: rows };
            }

            lastError = error;
            const canTryNext =
                (visibilityColumn === "is_public" && isMissingColumnError(error, "is_public"))
                || (visibilityColumn === "public" && isMissingColumnError(error, "public"));
            if (canTryNext) continue;
            break;
        }

        console.error("Error fetching public base layouts:", lastError);
        const cached = readCachedJson(PUBLIC_BASES_CACHE_KEY, { rows: [] });
        let rows = Array.isArray(cached?.rows) ? cached.rows : [];
        if (normalizedSearch) {
            rows = rows.filter((row) => {
                const name = String(row?.name || "").toLowerCase();
                const author = String(row?.author_name || "").toLowerCase();
                return name.includes(normalizedSearch) || author.includes(normalizedSearch);
            });
        }
        return {
            success: rows.length > 0,
            error: lastError,
            data: rows.slice(0, safeLimit)
        };
    } catch (error) {
        console.error("Error in fetchPublicBaseLayouts:", error);
        const cached = readCachedJson(PUBLIC_BASES_CACHE_KEY, { rows: [] });
        const rows = Array.isArray(cached?.rows) ? cached.rows : [];
        return { success: rows.length > 0, error, data: rows };
    }
}

export async function fetchPublicBaseLayoutById(layoutId) {
    try {
        const id = Number(layoutId);
        if (!Number.isFinite(id) || id <= 0) {
            return { success: false, error: "invalid_layout_id", data: null };
        }

        const path = `/rest/v1/${BASE_LAYOUTS_TABLE}?select=${encodeURIComponent(BASE_LAYOUTS_SELECT_FIELDS)}&id=eq.${id}&limit=1`;
        const authToken = await getCurrentAccessToken();
        const restResult = await postgrestRequestWithRetry(path, { timeoutMs: 18000, authToken }, 2);
        if (restResult.ok) {
            const rawRow = Array.isArray(restResult.data) ? (restResult.data[0] || null) : restResult.data;
            const row = rawRow ? {
                ...rawRow,
                snapshot: normalizeBaseLayoutSnapshot(rawRow?.snapshot)
            } : null;
            return { success: Boolean(row), data: row, error: row ? null : "layout_not_found" };
        }
        return { success: false, data: null, error: restResult.error || "layout_not_found" };
    } catch (error) {
        console.error("Error in fetchPublicBaseLayoutById:", error);
        return { success: false, data: null, error };
    }
}

export async function fetchGlobalAccountLeaderboard(limit = 10) {
    const normalizeStatistics = (statistics) => {
        if (!statistics) return {};
        if (typeof statistics === "string") {
            try {
                return JSON.parse(statistics) || {};
            } catch {
                return {};
            }
        }
        return typeof statistics === "object" ? statistics : {};
    };

    const mapLeaderboardRows = (rows, safeLimit) => {
        return (Array.isArray(rows) ? rows : []).map((row) => {
            const stats = normalizeStatistics(row?.statistics);
            const rawName = row?.nickname
                || row?.username
                || row?.display_name
                || row?.name
                || row?.discord_username
                || row?.discord?.username
                || (typeof row?.email === "string" ? row.email.split("@")[0] : null)
                || "Player";
            return {
                name: String(rawName),
                email: typeof row?.email === "string" ? row.email : "",
                role: typeof row?.role === "string" ? row.role : "",
                highscore: Math.max(0, Number(row?.highscore ?? stats?.highscore ?? stats?.score ?? 0)),
                playtime: Math.max(0, Number(row?.playtime ?? stats?.playtime ?? stats?.time_played ?? 0)),
                kills: Math.max(0, Number(row?.total_kills ?? stats?.kills ?? stats?.total_kills ?? 0))
            };
        })
            .sort((a, b) => (b.highscore - a.highscore) || (b.kills - a.kills) || (b.playtime - a.playtime))
            .slice(0, safeLimit);
    };

    const fetchRowsViaRest = async () => {
        const readLimit = 120;
        const authToken = await getCurrentAccessToken(1200);
        const paths = [
            `/rest/v1/users?select=nickname,email,role,highscore,playtime,total_kills,statistics&order=highscore.desc.nullslast,total_kills.desc.nullslast,playtime.desc.nullslast&limit=${readLimit}`,
            `/rest/v1/users?select=nickname,email,statistics&limit=${readLimit}`,
            "/rest/v1/users?select=*&limit=40"
        ];

        let lastError = null;
        for (const path of paths) {
            let result = null;
            try {
                // Keep leaderboard independent from user auth session state.
                result = await withTimeoutPromise(
                    postgrestRequestWithRetry(path, { timeoutMs: 11000, authToken: authToken || null }, 1),
                    13000,
                    "leaderboard_timeout"
                );
            } catch (timeoutError) {
                result = {
                    ok: false,
                    error: {
                        code: "leaderboard_timeout",
                        message: String(timeoutError?.message || "leaderboard_timeout")
                    }
                };
            }
            if (result.ok) {
                return { rows: Array.isArray(result.data) ? result.data : [], error: null };
            }
            lastError = result.error;
        }

        return { rows: [], error: lastError || { message: "leaderboard_rest_failed" } };
    };

    try {
        const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));
        const cacheKey = `top:${safeLimit}`;
        const now = Date.now();
        const persistentCache = readCachedJson(GLOBAL_RANK_CACHE_KEY, {});
        const persistentRows = Array.isArray(persistentCache?.[cacheKey]) ? persistentCache[cacheKey] : [];
        if (leaderboardCache.key === cacheKey && leaderboardCache.data.length > 0 && (now - leaderboardCache.fetchedAt) < LEADERBOARD_CACHE_TTL_MS) {
            return leaderboardCache.data;
        }

        if (leaderboardCache.key === cacheKey && leaderboardCache.inFlight) {
            return leaderboardCache.inFlight;
        }

        leaderboardCache.key = cacheKey;
        leaderboardCache.inFlight = (async () => {
            let primary = null;
            try {
                primary = await withTimeoutPromise(
                    fetchRowsViaRest(),
                    15000,
                    "leaderboard_timeout"
                );
            } catch (error) {
                primary = {
                    rows: [],
                    error: {
                        code: "leaderboard_timeout",
                        message: String(error?.message || "leaderboard_timeout")
                    }
                };
            }
            if (!primary.error) {
                const mapped = mapLeaderboardRows(primary.rows, safeLimit);
                leaderboardCache.data = mapped;
                leaderboardCache.fetchedAt = Date.now();
                writeCachedJson(GLOBAL_RANK_CACHE_KEY, {
                    ...persistentCache,
                    [cacheKey]: mapped
                });
                return mapped;
            }

            console.error("Error fetching global account leaderboard:", primary.error);
            if (leaderboardCache.data.length > 0) {
                return leaderboardCache.data;
            }
            if (persistentRows.length > 0) {
                return persistentRows;
            }
            return [];
        })();

        const result = await leaderboardCache.inFlight;
        leaderboardCache.inFlight = null;
        return result;
    } catch (error) {
        leaderboardCache.inFlight = null;
        console.error("Error in fetchGlobalAccountLeaderboard:", error);
        if (leaderboardCache.data.length > 0) {
            return leaderboardCache.data;
        }
        const persistentCache = readCachedJson(GLOBAL_RANK_CACHE_KEY, {});
        const cacheKey = `top:${Math.max(1, Math.min(25, Number(limit) || 10))}`;
        const persistentRows = Array.isArray(persistentCache?.[cacheKey]) ? persistentCache[cacheKey] : [];
        if (persistentRows.length > 0) {
            return persistentRows;
        }
        return [];
    }
}

const USER_HUD_SETTINGS_TABLE = "user_hud_settings";

export async function fetchUserHudSettings(userId) {
    try {
        if (!userId) return { success: false, error: "missing_user_id", data: null };
        const { data, error } = await supabase
            .from(USER_HUD_SETTINGS_TABLE)
            .select("config_json, updated_at")
            .eq("user_id", userId)
            .maybeSingle();

        if (error) {
            if (isMissingTableOrEndpointError(error)) {
                return { success: false, error: "hud_settings_unavailable", data: null };
            }
            console.error("Error fetching user HUD settings:", error);
            return { success: false, error, data: null };
        }

        return {
            success: true,
            data: data?.config_json || null,
            updatedAt: data?.updated_at || null
        };
    } catch (error) {
        console.error("Error in fetchUserHudSettings:", error);
        return { success: false, error, data: null };
    }
}

export async function upsertUserHudSettings(userId, config) {
    try {
        if (!userId) return { success: false, error: "missing_user_id" };
        const payload = {
            user_id: String(userId),
            config_json: config || {},
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from(USER_HUD_SETTINGS_TABLE)
            .upsert(payload, { onConflict: "user_id" });

        if (error) {
            if (isMissingTableOrEndpointError(error)) {
                return { success: false, error: "hud_settings_unavailable" };
            }
            console.error("Error upserting user HUD settings:", error);
            return { success: false, error };
        }
        return { success: true };
    } catch (error) {
        console.error("Error in upsertUserHudSettings:", error);
        return { success: false, error };
    }
}
