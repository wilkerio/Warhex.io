import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://sbwotyhotmthlmtysltl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNid290eWhvdG10aGxtdHlzbHRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2Njg1NDczNSwiZXhwIjoyMDgyNDMwNzM1fQ.M5na5xG06z_PptrSK5Uxgx9aKN4n7lBB3F6k2JEiST8';

export const supabase = createClient(supabaseUrl, supabaseKey);

const LOCAL_SESSION_KEY = 'blobl_supabase_session';

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

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    try { localStorage.removeItem(LOCAL_SESSION_KEY); } catch (e) { }
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

// Function to fetch skins from Supabase storage bucket
export async function fetchSkins() {
    try {
        const { data, error } = await supabase.storage.from('skins').list();
        if (error) {
            console.error('Error fetching skins from storage:', error);
            return [];
        }

        // Filter only PNG files, sort alphabetically, and create skin objects with URLs
        const skins = data
            .filter(file => file.name.endsWith('.png'))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((file, index) => {
                const publicUrl = supabase.storage.from('skins').getPublicUrl(file.name).data.publicUrl;
                const skinName = file.name.replace('.png', '');
                return {
                    id: skinName, // Use name as ID for consistency
                    name: skinName,
                    url: publicUrl,
                    category: 'default',
                    unlocked: true, // Default skins are free for everyone
                    requiredLevel: 0,
                    price: 0,
                    isPurchasable: false
                };
            });

        console.log('Fetched skins from storage:', skins);
        return skins;
    } catch (error) {
        console.error('Error in fetchSkins:', error);
        return [];
    }
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