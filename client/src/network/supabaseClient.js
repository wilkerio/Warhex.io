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

        // Filter only PNG files, sort alphabetically, and create skin objects
        const skins = data
            .filter(file => file.name.endsWith('.png'))
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((file, index) => ({
                id: index + 1,
                name: file.name.replace('.png', ''),
                category: 'default',
                base_color: 'transparent'
            }));

        console.log('Fetched skins from storage:', skins);
        return skins;
    } catch (error) {
        console.error('Error in fetchSkins:', error);
        return [];
    }
}