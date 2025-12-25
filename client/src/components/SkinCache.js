export default class SkinCache {
    // Start with empty categories and ID ranges
    static categories = {};
    static categoryRanges = {};

    static cache = new Map();
    static localStorageSkinDataKey = "skinData";

    // Initialize categories and ID ranges from localStorage if available
    static initializeFromLocalStorage () {
        try {
            const storedData = localStorage.getItem(this.localStorageSkinDataKey);
            if (storedData) {
                this.categories = JSON.parse(storedData);
                this._initializeCategoryRanges();
                console.log('Categories initialized from localStorage.');
            } else {
                console.log('No skin data found in localStorage.');
            }
        } catch (error) {
            console.error('Error initializing categories from localStorage:', error);
        }
    }

    // Function to set all skins in the categories and store their ranges
    static setSkinData (skinData) {
        try {
            // Populate categories with the new skin data
            this.categories = {
                default: skinData.default || [],
                veteran: skinData.veteran || [],
                premium: skinData.premium || [],
            };

            // Initialize category ranges based on the skin data
            this._initializeCategoryRanges();

            // Save skin data to localStorage
            localStorage.setItem(this.localStorageSkinDataKey, JSON.stringify(this.categories));

            console.log('All skins have been set and stored.');
        } catch (error) {
            console.error('Error setting all skins:', error);
        }
    }

    // Initialize category ranges based on skin data
    static _initializeCategoryRanges () {
        this.categoryRanges = {};

        for (const category in this.categories) {
            const skins = this.categories[category];
            if (skins.length > 0) {
                this.categoryRanges[category] = {
                    firstId: skins[0].id,
                    lastId: skins[skins.length - 1].id,
                };
            }
        }
    }

    // Function to get the category based on ID
    static _getCategoryById (id) {
        for (const category in this.categoryRanges) {
            const { firstId, lastId } = this.categoryRanges[category];
            if (id >= firstId && id <= lastId) {
                return category;
            }
        }
        return 'premium'; // default category if not found
    }

    // Get skin data by category and ID
    static _getSkinData (category, id) {
        const skins = SkinCache.categories[category];
        const index = skins.findIndex(skin => skin.id === id);  // Find the index based on the id
        const skin = skins[index];

        if (skin && skin.name) {
            return {
                path: `assets/skins/${category}/${skin.name}.webp`,
            };
        }
        return null;
    }

    static getAllSkinsByCategory(category) {
        try {
            if (this.categories[category]) {
                return this.categories[category];
            } else {
                console.error(`Category ${category} does not exist.`);
                return [];
            }
        } catch (error) {
            console.error('Error fetching skin data by category:', error);
            return [];
        }
    }

    static async getSkin (id) {
        try {
            const category = SkinCache._getCategoryById(id);
            const skinData = SkinCache._getSkinData(category, id);

            if (!skinData) {
                console.error('Skin data not found for id:', id);
                return null;
            }

            const { path } = skinData;

            // Check if the skin is already cached
            if (SkinCache.cache.has(id)) {
                return SkinCache.cache.get(id);
            }

            const image = await SkinCache._fetchAndCacheImage(path, id);

            // Cache the image
            SkinCache.cache.set(id, { image });

            return { image };
        } catch (error) {
            console.error('Error loading skin:', error);
            return null;
        }
    }

    static async _fetchAndCacheImage (path, id) {
        try {
            const image = await SkinCache._fetchImage(path);
            return image;
        } catch {
            return null;
        }
    }

    static _fetchImage (path) {
        const img = new Image();
        return new Promise((resolve, reject) => {
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = path;
        });
    }

    // Check if skinData in localStorage is empty
    static isSkinDataEmpty () {
        try {
            const cachedData = localStorage.getItem(SkinCache.localStorageSkinDataKey);
            return !cachedData || Object.keys(JSON.parse(cachedData)).length === 0;
        } catch (error) {
            console.error('Error checking localStorage skin data:', error);
            return true;
        }
    }

    static clearSkinData () {
        try {
            localStorage.removeItem(SkinCache.localStorageSkinDataKey);
        } catch (error) {
            console.error('Error clearing localStorage skin data:', error);
        }
    }
}
