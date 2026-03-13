import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sbwotyhotmthlmtysltl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNid290eWhvdG10aGxtdHlzbHRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Njg1NDczNSwiZXhwIjoyMDgyNDMwNzM1fQ.M5na5xG06z_PptrSK5Uxgx9aKN4n7lBB3F6k2JEiST8';

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Callback exchange is handled explicitly in consumeOAuthCallbackSession().
        detectSessionInUrl: false,
        // Prevent Browser LockManager timeouts in environments with duplicated init/reload.
        multiTab: false
    }
});

const LOCAL_SESSION_KEY = 'blobl_supabase_session';
const SKINS_CACHE_TTL_MS = 10 * 60 * 1000;
const LEADERBOARD_CACHE_TTL_MS = 60 * 1000;
const STORAGE_LIST_PAGE_SIZE = 100;
const STORAGE_LIST_MAX_REQUESTS = 20;

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
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                nickname: nickname
            }
        }
    });
    if (error) throw error;
    return data;
}

export async function signIn(email, password) {
    console.log('Attempting sign in with email:', email);
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
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
        const oauthError = url.searchParams.get("error");
        const oauthErrorDescription = url.searchParams.get("error_description");
        if (oauthError) {
            storeOAuthLastError(oauthErrorDescription || oauthError);
            cleanupOAuthParamsFromCurrentUrl();
            return {
                consumed: true,
                session: null,
                error: new Error(oauthErrorDescription || oauthError)
            };
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
            const { data, error } = await supabase
                .from("users")
                .upsert(payload, { onConflict: "id" })
                .select("*")
                .single();

            if (!error) {
                return { success: true, data: normalizeUserRow(data) };
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
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) authError = error;
    } catch (error) {
        authError = error;
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
        // setSession accepts an object with access_token and refresh_token
        const { data, error } = await supabase.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token
        });
        if (error) {
            console.error('Error restoring session via setSession:', error);
            return null;
        }
        return data.session || null;
    } catch (e) {
        console.error('Error in restoreSessionFromStorage:', e);
        return null;
    }
}

// Recursively list all files in the Supabase storage bucket (supports nested folders)
async function listAllStorageFiles(prefix = '', state = { requests: 0 }) {
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
        const { data, error } = await retryWithBackoff(() => supabase.storage.from('skins').list(prefix, {
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
                const nested = await listAllStorageFiles(fullPath, state);
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
        const files = await listAllStorageFiles('');

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

// Persist user progression/stats after a round ends.
export async function updateUserProgressStats(userId, progression, statistics) {
    try {
        if (!userId) return { success: false, error: "missing_user_id" };

        // Keep this payload aligned with the current public.users schema.
        const payload = {
            highscore: Number(statistics?.highscore || 0),
            total_kills: Number(statistics?.kills || 0),
            playtime: Number(statistics?.playtime || 0)
        };

        const url = `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`;
        const resp = await fetch(url, {
            method: "PATCH",
            headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            },
            body: JSON.stringify(payload)
        });

        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            const error = text || resp.statusText || String(resp.status);
            console.error("Error updating user progression/stats:", error);
            return { success: false, error };
        }

        return { success: true };
    } catch (error) {
        console.error("Error in updateUserProgressStats:", error);
        return { success: false, error };
    }
}

// Same stats update, but resilient during tab close/reload via keepalive fetch.
export async function updateUserProgressStatsKeepalive(userId, statistics) {
    try {
        if (!userId) return { success: false, error: "missing_user_id" };

        const payload = {
            highscore: Number(statistics?.highscore || 0),
            total_kills: Number(statistics?.kills || 0),
            playtime: Number(statistics?.playtime || 0)
        };

        const url = `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`;
        const resp = await fetch(url, {
            method: "PATCH",
            keepalive: true,
            headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
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

export async function publishBaseLayout({ userId, authorName, name, snapshot, buildings, isPublic = true }) {
    try {
        const payload = {
            user_id: userId || null,
            author_name: authorName || "Guest",
            name: (name || "Unnamed Base").trim(),
            snapshot: snapshot || null,
            layout_json: { buildings: Array.isArray(buildings) ? buildings : [] },
            is_public: Boolean(isPublic)
        };

        const { data, error } = await supabase
            .from(BASE_LAYOUTS_TABLE)
            .insert(payload)
            .select("id, name, author_name, snapshot, created_at, layout_json, is_public")
            .single();

        if (error) {
            console.error("Error publishing base layout:", error);
            return { success: false, error };
        }

        return { success: true, data };
    } catch (error) {
        console.error("Error in publishBaseLayout:", error);
        return { success: false, error };
    }
}

export async function fetchPublicBaseLayouts(searchText = "", limit = 30) {
    try {
        let query = supabase
            .from(BASE_LAYOUTS_TABLE)
            .select("id, name, author_name, snapshot, created_at, layout_json")
            .eq("is_public", true)
            .order("created_at", { ascending: false })
            .limit(Math.max(1, Math.min(100, limit)));

        const term = (searchText || "").trim();
        if (term) {
            query = query.or(`name.ilike.%${term}%,author_name.ilike.%${term}%`);
        }

        const { data, error } = await query;
        if (error) {
            console.error("Error fetching public base layouts:", error);
            return { success: false, error, data: [] };
        }

        return { success: true, data: data || [] };
    } catch (error) {
        console.error("Error in fetchPublicBaseLayouts:", error);
        return { success: false, error, data: [] };
    }
}

export async function fetchGlobalAccountLeaderboard(limit = 10) {
    const withTimeout = async (promise, ms = 4000) => {
        let timeoutId = null;
        try {
            return await Promise.race([
                promise,
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error("leaderboard_timeout")), ms);
                })
            ]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    };

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

    try {
        const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));
        const cacheKey = `top:${safeLimit}`;
        const now = Date.now();
        if (leaderboardCache.key === cacheKey && leaderboardCache.data.length > 0 && (now - leaderboardCache.fetchedAt) < LEADERBOARD_CACHE_TTL_MS) {
            return leaderboardCache.data;
        }

        if (leaderboardCache.key === cacheKey && leaderboardCache.inFlight) {
            return leaderboardCache.inFlight;
        }

        leaderboardCache.key = cacheKey;
        leaderboardCache.inFlight = (async () => {
        const queryAttempts = [
            () => supabase.from("users").select("nickname, username, email, role, highscore, playtime, total_kills, statistics").limit(200),
            () => supabase.from("users").select("nickname, username, email, role, statistics").limit(200),
            () => supabase.from("users").select("*").limit(200)
        ];

        let data = [];
        let error = null;

        for (const runQuery of queryAttempts) {
            const result = await withTimeout(runQuery(), 4500).catch((e) => ({ data: null, error: e }));
            data = result?.data || [];
            error = result?.error || null;
            if (!error) break;
        }

        if (error) {
            console.error("Error fetching global account leaderboard:", error);
            if (leaderboardCache.data.length > 0) {
                return leaderboardCache.data;
            }
            return [];
        }
        const mapped = mapLeaderboardRows(data, safeLimit);
        leaderboardCache.data = mapped;
        leaderboardCache.fetchedAt = Date.now();
        return mapped;
        })();

        const result = await leaderboardCache.inFlight;
        leaderboardCache.inFlight = null;
        return result;
    } catch (error) {
        leaderboardCache.inFlight = null;
        console.error("Error in fetchGlobalAccountLeaderboard:", error);
        try {
            const safeLimit = Math.max(1, Math.min(25, Number(limit) || 10));
            const urls = [
                `${supabaseUrl}/rest/v1/users?select=nickname,username,email,role,highscore,playtime,total_kills,statistics&limit=200`,
                `${supabaseUrl}/rest/v1/users?select=nickname,username,email,role,statistics&limit=200`,
                `${supabaseUrl}/rest/v1/users?select=*&limit=200`
            ];

            for (const url of urls) {
                const resp = await withTimeout(fetch(url, {
                    headers: {
                        "apikey": supabaseKey,
                        "Authorization": `Bearer ${supabaseKey}`
                    }
                }), 4500);
                if (!resp.ok) continue;
                const rows = await resp.json();
                const mapped = mapLeaderboardRows(rows, safeLimit);
                leaderboardCache.data = mapped;
                leaderboardCache.fetchedAt = Date.now();
                return mapped;
            }

            if (leaderboardCache.data.length > 0) {
                return leaderboardCache.data;
            }
            return [];
        } catch (fallbackError) {
            console.error("Global leaderboard fallback failed:", fallbackError);
            if (leaderboardCache.data.length > 0) {
                return leaderboardCache.data;
            }
            return [];
        }
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
            console.error("Error upserting user HUD settings:", error);
            return { success: false, error };
        }
        return { success: true };
    } catch (error) {
        console.error("Error in upsertUserHudSettings:", error);
        return { success: false, error };
    }
}
