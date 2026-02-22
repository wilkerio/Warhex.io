import { BuildingTypes, calculateRequiredXP, getAvailableBuildingUpgrades, getBuildingDetails, getColorForLevel, Servers, UnitTypes } from "../../network/constants.js";
import Network from "../../network/Network.js";
import SkinCache from "../SkinCache.js";
import { signUp, signIn, getCurrentUser, fetchSkins, updateSelectedSkin, publishBaseLayout, fetchPublicBaseLayouts } from "../../network/supabaseClient.js";
import { BuildingManager } from "./BuildingManager.js";
import ThemeManager from "./ThemeManager.js";
import UnitManager from "./UnitManager.js";

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
        this.loadingOverlay = null;
        this.timerInterval = null;
        this.lastSendMessage = "";
        this.isDraggingChat = false;
        this.isChatInputFocused = false;
        this.upgradePreviewRotation = 0;
        this.upgradeCostElements = []; // Stores elements for later updates 
        this.selectedUpgradeTab = 0;
        this.upgradePanelOpen = false;
        this.inactivityTimerInterval = null;
        this.inactivityTimeout = 600; // 10 minutes in seconds
        this.x1PromptElement = null;
        this.x1SendPromptElement = null;
        this.enemyCoreActionsElement = null;
        this.relocatePromptElement = null;
        this.baseLayoutDialogElement = null;
        this.x1StatusElement = null;
        this.x1StatusInterval = null;
        
        // Skin navigation properties
        this.currentSkinIndex = 0;
        this.availableSkins = [];
        this.skinPersistTimeout = null;

        this.initializeUIElements();
        this.initializeSkinsFromCache(); // First: load from localStorage cache
        this.loadSupabaseSkins(); // Then: fetch fresh from Supabase (updates cache)
        this.addLoginDialogButtonListener();
        this.addPlayButtonListener();
        this.addContinueButtonListener();
        this.addMenuDialogButtonListener();
        this.addSkinNavigationListeners(); // New: skin navigation
        this.addSkinUseButtonListener(); // New: Use button
        this.addSkinCircleClickListener(); // New: click on circle to open library
        this.addSkinLibraryButtonListener();
        this.addSettingsPanelListener();
        this.addChatButtonElementListener();
        this.addUnitControlsListener();
        this.addAutoBuildMenuButtons();
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
            } else if (this.availableSkins.length <= 1) {
                const fallbackSkins = this.getFallbackCatalogSkins();
                if (fallbackSkins.length > 0) {
                    this.availableSkins = this.buildAvailableSkins(fallbackSkins);
                    this.currentSkinIndex = Math.min(this.currentSkinIndex, this.availableSkins.length - 1);
                    this.updateSkinCircle();
                    this.updateUseButton();
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
                }
            }
        }
    }

    initializeUIElements () {
        const elementSelectors = {
            // Menu-related elements
            menu: {
                screen: "menu-container",
                playButton: "play-button",
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
                signupSubmit: "signup-submit",
                signupCancel: "signup-cancel",
                // Signin dialog inputs
                signinEmail: "signin-email",
                signinPassword: "signin-password",
                signinSubmit: "signin-submit",
                signinCancel: "signin-cancel",
                progression: {
                    progressIcon: "#level-progression .progress-icon",
                    progressBar: "#level-progression .progress-bar",
                    progressText: "#level-progression .progress-text"
                }
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
        return; // Not implemented yet
        try {
            const response = await fetch("https://leaderboard.blobl.io");

            // Check if the response is ok (status code 200-299)
            if (!response.ok) {
                throw new Error("Network response was not ok " + response.statusText);
            }

            const leaderboardData = await response.json();

            this.globalLeaderboard = leaderboardData;
            const leaderboard = document.getElementById("global-leaderboard");
            leaderboard.innerHTML = "<h2>This Week's Champions</h2>";
            leaderboardData.forEach((entry, index) => {
                const container = document.createElement("p");

                const rankSpan = document.createElement("span");
                rankSpan.classList.add("rank");
                rankSpan.textContent = `${index + 1}.`;

                const nameSpan = document.createElement("span");
                nameSpan.classList.add("name");
                nameSpan.textContent = entry.name;

                const scoreSpan = document.createElement("span");
                scoreSpan.classList.add("score");
                scoreSpan.textContent = entry.score;

                container.appendChild(rankSpan);
                container.appendChild(nameSpan);
                container.appendChild(scoreSpan);
                leaderboard.appendChild(container);
                leaderboard.style.display = "flex";
            });
        } catch (error) {
            console.error("Failed to fetch leaderboard:", error);
        }
    }

    addLoginDialogButtonListener () {
        // Account button - opens signin dialog or logs out
        if (this.DOM.account.accountButton) {
            this.DOM.account.accountButton.addEventListener("click", () => {
                if (this.core.networkManager.loggedIn) {
                    this.core.networkManager.logout();
                } else {
                    this.showSigninDialog(true);
                }
            });
        }

        // Signup button - opens signup dialog
        if (this.DOM.account.signupButton) {
            this.DOM.account.signupButton.addEventListener("click", () => {
                this.showSignupDialog(true);
            });
        }

        // Guest button - closes login dialog
        if (this.DOM.account.guestButton) {
            this.DOM.account.guestButton.addEventListener("click", () => {
                this.showLoginDialog(false);
            });
        }

        // Signup dialog handlers
        if (this.DOM.account.signupSubmit) {
            this.DOM.account.signupSubmit.addEventListener("click", async () => {
                const email = this.DOM.account.signupEmail?.value;
                const nickname = this.DOM.account.signupNickname?.value;
                const password = this.DOM.account.signupPassword?.value;

                if (!email || !nickname || !password) {
                    alert("Please enter email, nickname and password.");
                    return;
                }

                // Basic nickname validation
                if (nickname.length < 3) {
                    alert("Nickname must be at least 3 characters long.");
                    return;
                }

                if (!/^[a-zA-Z0-9_]+$/.test(nickname)) {
                    alert("Nickname can only contain letters, numbers and underscores.");
                    return;
                }

                try {
                    await signUp(email, password, nickname);
                    this.showSignupDialog(false);
                    alert("Account created! Please check your email to verify your account.");
                } catch (error) {
                    alert("Sign up failed: " + error.message);
                }
            });
        }

        if (this.DOM.account.signupCancel) {
            this.DOM.account.signupCancel.addEventListener("click", () => {
                this.showSignupDialog(false);
            });
        }

        // Signin dialog handlers
        if (this.DOM.account.signinSubmit) {
            this.DOM.account.signinSubmit.addEventListener("click", async () => {
                const email = this.DOM.account.signinEmail?.value;
                const password = this.DOM.account.signinPassword?.value;

                if (!email || !password) {
                    alert("Please enter email and password.");
                    return;
                }

                try {
                    await signIn(email, password);
                    this.showSigninDialog(false);
                    await this.core.networkManager.checkLoginStatus();
                } catch (error) {
                    alert("Login failed: " + error.message);
                }
            });
        }

        if (this.DOM.account.signinCancel) {
            this.DOM.account.signinCancel.addEventListener("click", () => {
                this.showSigninDialog(false);
            });
        }
    }

    showSignupDialog (show) {
        if (this.DOM.account.signupDialog) {
            this.DOM.account.signupDialog.style.display = show ? "flex" : "none";
        }
    }

    showSigninDialog (show) {
        if (this.DOM.account.signinDialog) {
            this.DOM.account.signinDialog.style.display = show ? "flex" : "none";
        }
    }

    async updateAccount () {
        const MAX_LEVEL = 40;

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
        const userData = this.core.networkManager.userData || defaultUserData;

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
        const isLoggedIn = this.core.networkManager.loggedIn;
        if (isLoggedIn && userData.nickname) {
            // Hide input and show nickname
            this.DOM.menu.playerNameInput.value = userData.nickname;
            localStorage.setItem("playerName", userData.nickname);
            this.DOM.menu.playerNameInput.style.display = 'none';
            this.DOM.menu.loggedInNickname.style.display = 'block';
            this.DOM.menu.loggedInNickname.textContent = `Playing as: ${userData.nickname}`;
        } else {
            // Show input and hide nickname
            this.DOM.menu.playerNameInput.style.display = 'block';
            this.DOM.menu.loggedInNickname.style.display = 'none';
        }

        // Handle progression data safely
        const level = userData.progression?.level || 1;
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

        // Fetch the equipped skin from SkinCache
        const previewButton = this.DOM?.skins?.previewButton;
        const equipped = userData.selected_skin
            ?? userData.skins?.equipped
            ?? localStorage.getItem('equippedSkin')
            ?? null;

        if (previewButton && equipped) {
            // Load either Supabase (string) or legacy (numeric) skins
            const skinImageData = typeof equipped === 'string'
                ? await SkinCache.getSkinByName(equipped)
                : await SkinCache.getSkin(equipped);

            if (skinImageData && skinImageData.image) {
                const img = document.createElement('img');
                img.src = skinImageData.image.src;

                previewButton.innerHTML = '';
                previewButton.appendChild(img);

                const plusDiv = document.createElement('div');
                plusDiv.textContent = '+';
                previewButton.appendChild(plusDiv);
            }
        } else if (previewButton) {
            previewButton.innerHTML = '<p>Skins</p>';
            const plusDiv = document.createElement('div');
            plusDiv.textContent = '+';
            previewButton.appendChild(plusDiv);
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
            { label: 'Highscore', value: formatScore(userData.statistics?.highscore) || "0" },
            { label: 'Playtime', value: formatPlaytime(userData.statistics?.playtime) },
            { label: 'Total Kills', value: userData.statistics?.kills || "0" }
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
        if (this.DOM.account.accountButton) {
            if (this.core.networkManager.loggedIn) {
                // Clear any existing classes before setting the "Logout" state
                this.DOM.account.accountButton.classList.remove("login");
                this.DOM.account.accountButton.textContent = "Logout";
                // Hide signup button when logged in
                if (this.DOM.account.signupButton) {
                    this.DOM.account.signupButton.style.display = "none";
                }
            } else {
                this.DOM.account.accountButton.classList.add("login");
                this.DOM.account.accountButton.textContent = "Login";
                // Show signup button when not logged in
                if (this.DOM.account.signupButton) {
                    this.DOM.account.signupButton.style.display = "block";
                }
            }
            this.DOM.account.accountButton.style.display = "block";
        }
        // Also update the account display
        this.updateAccount();
    }

    async updateSkinCircle() {
        const circle = document.getElementById('skin-preview-circle');
        const img = document.getElementById('current-skin-img');
        const nameDisplay = document.getElementById('skin-name-display');
        const prevBtn = document.getElementById('skin-carousel-prev-menu');
        const nextBtn = document.getElementById('skin-carousel-next-menu');
        
        if (!circle || !img || !nameDisplay) {
            return; // Elements not ready yet
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
                img.src = '';
                img.style.display = 'none';
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

    goPrevSkin(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const total = this.availableSkins.length;
        if (total <= 1) return;
        this.currentSkinIndex = (this.currentSkinIndex - 1 + total) % total;
        this.updateSkinCircle();
    }

    goNextSkin(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        const total = this.availableSkins.length;
        if (total <= 1) return;
        this.currentSkinIndex = (this.currentSkinIndex + 1) % total;
        this.updateSkinCircle();
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
        
        // If logged in, save to database
        const isLoggedIn = this.core.networkManager.loggedIn;
        const userId = this.core.networkManager.userId;
        
        if (persistRemote && isLoggedIn && userId) {
            if (this.skinPersistTimeout) {
                clearTimeout(this.skinPersistTimeout);
            }
            this.skinPersistTimeout = setTimeout(async () => {
                try {
                    await updateSelectedSkin(userId, skinName);
                    console.log('Skin saved to database');
                    if (this.core.networkManager.userData) {
                        this.core.networkManager.userData.selected_skin = skinName;
                        if (this.core.networkManager.userData.skins) {
                            this.core.networkManager.userData.skins.equipped = skinNumeric;
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
                placeholder.textContent = '🎮';
                skinCard.appendChild(placeholder);
            }
            
            const nameLabel = document.createElement('p');
            nameLabel.classList.add('skin-name');
            nameLabel.textContent = skin.name;
            skinCard.appendChild(nameLabel);
            
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

    animatePreview (previewCanvas, renderable) {
        const context = previewCanvas.getContext("2d");
        let animationFrameId; // Store the animation frame ID
        const scale = 0.8;
        const rotationSpeed = 0.001; // Adjust this value to control the rotation speed
        let lastTime = 0; // Initialize lastTime to 0

        renderable.rotationAngle = this.upgradePreviewRotation; // Initialize rotation angle for the building

        const animate = (currentTime) => {
            // Calculate deltaTime (time difference between frames)
            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;

            // Update rotation angle using deltaTime
            this.upgradePreviewRotation += rotationSpeed;
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



            // Request the next frame
            animationFrameId = requestAnimationFrame(animate);
        };

        // Start the animation
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

    showCoreUpgrades (onUpgradeSelect) {
        const upgradeHotkeys = ["Q", "E", "T"];

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

            const preview = document.createElement("canvas");
            preview.classList.add("preview");
            preview.width = 80;
            preview.height = 80;

            let renderable;
            if (upgradeInfo.unitType) {
                const UnitClass = UnitManager.getUnitClassByType(upgradeInfo.unitType);
                renderable = new UnitClass(this.core.gameManager.player.color, { x: 0, y: 0 }, 0);
            }

            if (renderable) {
                this.animatePreview(preview, renderable);
            }

            const description = document.createElement("div");
            description.classList.add("description");

            description.innerHTML = `
                <p class="header">${upgradeInfo.name}</p>
                <p class="text">${upgradeInfo.description}</p>
                <p class="hotkey">[${upgradeHotkeys[index]}]</p>
                <p class="cost">${upgradeInfo.cost} Power</p>
            `;
            this.upgradeCostElements.push({ cost: upgradeInfo.cost, element: description.querySelector(".cost") });

            upgradeItem.appendChild(preview);
            upgradeItem.appendChild(description);

            upgradeItem.addEventListener("click", () => {
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


        // Populate available upgrades
        availableUpgrades.forEach((upgradeInfo, index) => createUpgradeItem(upgradeInfo, index));

        // Handle cases with no or fewer upgrades than expected
        handleEmptyUpgrades(availableUpgrades);

        this.DOM.game.upgrades.destroyButton.style.display = "none";

        // Show the upgrade container
        this.DOM.game.upgrades.container.style.display = "flex";
    }

    showUpgrades (building, onUpgradeSelect, onDestroyClicked) {
        this.hideUpgrades();
        this.DOM.game.upgrades.list.innerHTML = "";

        // Set up destroy button
        this.DOM.game.upgrades.destroyButton.removeEventListener("click", this.destroyClickHandler);
        this.destroyClickHandler = () => onDestroyClicked();
        this.DOM.game.upgrades.destroyButton.addEventListener("click", this.destroyClickHandler);

        if (onUpgradeSelect === null) {
            // MULTIPLE BUILDING TYPES
            document.querySelector("#upgrade-container h1").textContent = "Multiple Buildings";
            
            let totalRefund = 0;
            building.buildings.forEach(b => {
                const buildingDetails = getBuildingDetails(b.type, b.variant);
                if (buildingDetails) {
                    totalRefund += Math.floor(buildingDetails.cost / 2);
                }
            });
            this.DOM.game.upgrades.destroyButton.innerHTML = `<p>Destroy</p><p class="refund-amount">+${totalRefund} Power</p>`;
            this._clearUpgradeTabsElement();

            // Show a summary of the multiple selection: total count and counts per building type
            if (this.DOM.game.upgrades.list) {
                this.DOM.game.upgrades.list.innerHTML = "";

                const countsByType = new Map();
                building.buildings.forEach(b => {
                    const details = getBuildingDetails(b.type, b.variant);
                    const name = details ? details.name : (Object.keys(BuildingTypes).find(k => BuildingTypes[k] === b.type) || "Unknown");
                    countsByType.set(name, (countsByType.get(name) || 0) + 1);
                });

                const summary = document.createElement("div");
                summary.classList.add("multiple-selection-summary");
                const totalEl = document.createElement("p");
                totalEl.classList.add("summary-total");
                totalEl.textContent = `Total selected: ${building.count}`;
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
            const upgradeHotkeys = ["Q", "E", "T", "R", "Y"];

            const getAvailableUpgrades = () => {
                const purchasedVariants = building.purchasedUpgrades ? Array.from(building.purchasedUpgrades) : [];
                return getAvailableBuildingUpgrades(building.type, building.variant, purchasedVariants);
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

                const hotkey = upgradeHotkeys[index] ?? "-";
                description.innerHTML = `
                    <p class="header">${upgradeInfo.name}</p>
                    <p class="text">${upgradeInfo.description}</p>
                    <p class="hotkey">[${hotkey}]</p>
                    <p class="cost">${upgradeInfo.cost} Power</p>
                `;
                this.upgradeCostElements.push({ cost: upgradeInfo.cost, element: description.querySelector(".cost") });

                upgradeItem.appendChild(preview);
                upgradeItem.appendChild(description);

                upgradeItem.addEventListener("click", () => {
                    const upgradeData = isArmory
                        ? {
                            unitType: upgradeInfo.unitType ?? this.selectedUpgradeTab,
                            unitVariant: upgradeInfo.unitVariant ?? upgradeInfo.variant,
                            buildingVariant: upgradeInfo.variant,
                            cost: upgradeInfo.cost
                        }
                        : { buildingVariant: upgradeInfo.variant, cost: upgradeInfo.cost };
                    onUpgradeSelect(upgradeData);
                });

                this.DOM.game.upgrades.list.appendChild(upgradeItem);

                this._updateCost();
            };

            const handleEmptyUpgrades = (availableUpgrades) => {
                if (isArmory && availableUpgrades.length < 2) {
                    for (let i = 0; i < 2 - availableUpgrades.length; i++) {
                        const comingSoonItem = document.createElement("div");
                        comingSoonItem.classList.add("upgrade-item", "coming-soon");
                        comingSoonItem.innerHTML = "<p>In the lab—upgrades incoming!</p>";
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

            availableUpgrades.forEach((upgradeInfo, index) => {
                if (upgradeInfo && (upgradeInfo.baseCost || upgradeInfo.cost)) {
                    const baseCost = upgradeInfo.baseCost ?? upgradeInfo.cost;
                    const calculatedCost = baseCost * building.count;
                    const upgradeInfoCopy = { ...upgradeInfo, cost: calculatedCost };
                    createUpgradeItem(upgradeInfoCopy, index);
                } else {
                    console.warn(`Invalid upgradeInfo at index ${index}:`, upgradeInfo);
                }
            });
            
            handleEmptyUpgrades(availableUpgrades);

            const buildingDetails = getBuildingDetails(building.type, building.variant);
            if (buildingDetails) {
                const refundAmount = Math.floor(buildingDetails.cost * building.count / 2);
                this.DOM.game.upgrades.destroyButton.innerHTML = `<p>Destroy</p><p class="refund-amount">+${refundAmount} Power</p>`;
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

    hideUpgrades () {
        if (this.DOM.game.upgrades.container.style.display === "none") return;
        this.upgradeCostElements = []; // Clear


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
    }

    addChatMessage (username, message, color, player = null) {
        if (!this.DOM.chat.messages) return;

        // Create a new chat message div
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message");

        // Check for mention
        if (this.core.gameManager.player && message.includes('@' + this.core.gameManager.player.name)) {
            messageDiv.classList.add("mention-highlight");
        }

        // Create and set username span
        const usernameSpan = document.createElement("span");
        usernameSpan.classList.add("name");
        usernameSpan.textContent = username;
        usernameSpan.style.color = color;
        if (player) {
            usernameSpan.style.cursor = "pointer";
            // Add click event listener to usernameSpan
            usernameSpan.addEventListener("click", () => this.handleUsernameClick(player));
        }

        // Create and set message span
        const messageSpan = document.createElement("span");
        messageSpan.classList.add("text");
        messageSpan.textContent = message;

        // Append username and message spans to message div
        messageDiv.appendChild(usernameSpan);
        messageDiv.appendChild(messageSpan);

        // Append the new message div to the chat messages container
        this.DOM.chat.messages.appendChild(messageDiv);

        // Ensure no more than 15 messages are shown
        this.limitChatMessages(15);

        // Scroll to the bottom to show the latest message
        this.DOM.chat.messages.scrollTop = this.DOM.chat.messages.scrollHeight;
    }

    // Helper method to limit the number of chat messages displayed
    limitChatMessages (maxMessages) {
        const messages = this.DOM.chat.messages.querySelectorAll(".message");
        if (messages.length > maxMessages) {
            // Remove the oldest message
            this.DOM.chat.messages.removeChild(messages[0]);
        }
    }

    handleUsernameClick (player) {
        this.core.camera.setPosition(player.position, true);
    }

    addUnitControlsListener() {
        if (!this.DOM.game.unitControls.groupUnitsButton) return;

        this.groupUnitsActive = false;
        this.DOM.game.unitControls.groupUnitsButton.innerText = "Group Off";

        this.DOM.game.unitControls.groupUnitsButton.addEventListener("click", () => {
            this.groupUnitsActive = !this.groupUnitsActive;
            if (this.groupUnitsActive) {
                this.DOM.game.unitControls.groupUnitsButton.classList.add("active");
                this.DOM.game.unitControls.groupUnitsButton.innerText = "Group On";
            } else {
                this.DOM.game.unitControls.groupUnitsButton.classList.remove("active");
                this.DOM.game.unitControls.groupUnitsButton.innerText = "Group Off";
            }
    
            this.core.networkManager.sendToggleGroupUnits(this.groupUnitsActive);
        });
    }

    addAutoBuildMenuButtons () {
        const gameContainer = this.DOM?.game?.container;
        if (!gameContainer) return;
        if (document.getElementById("autobuild-menu-container")) return;

        const container = document.createElement("div");
        container.id = "autobuild-menu-container";
        container.style.position = "absolute";
        container.style.top = "10px";
        container.style.left = "50%";
        container.style.transform = "translateX(-50%)";
        container.style.display = "none";
        container.style.width = "560px";
        container.style.height = "46px";
        container.style.zIndex = "30";
        container.style.pointerEvents = "auto";

        const pullTab = document.createElement("button");
        pullTab.type = "button";
        pullTab.textContent = "MENU";
        pullTab.style.pointerEvents = "auto";
        pullTab.style.position = "absolute";
        pullTab.style.left = "50%";
        pullTab.style.transform = "translateX(-50%)";
        pullTab.style.top = "0";
        pullTab.style.width = "132px";
        pullTab.style.height = "46px";
        pullTab.style.padding = "0";
        pullTab.style.border = "1px solid #3f6ec0";
        pullTab.style.borderRadius = "12px";
        pullTab.style.background = "linear-gradient(180deg, rgba(59,99,170,0.95) 0%, rgba(24,52,104,0.95) 100%)";
        pullTab.style.color = "#d9e7ff";
        pullTab.style.cursor = "pointer";
        pullTab.style.fontWeight = "700";
        pullTab.style.letterSpacing = "0.5px";

        const actionsPanel = document.createElement("div");
        actionsPanel.style.position = "absolute";
        actionsPanel.style.left = "0";
        actionsPanel.style.top = "0";
        actionsPanel.style.width = "560px";
        actionsPanel.style.height = "46px";
        actionsPanel.style.display = "none";
        actionsPanel.style.padding = "2px";
        actionsPanel.style.boxSizing = "border-box";
        actionsPanel.style.borderRadius = "14px";
        actionsPanel.style.border = "1px solid rgba(132, 170, 255, 0.35)";
        actionsPanel.style.background = "linear-gradient(180deg, rgba(20,36,88,0.78) 0%, rgba(10,20,58,0.78) 100%)";
        actionsPanel.style.boxShadow = "0 8px 22px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.08)";
        actionsPanel.style.backdropFilter = "blur(3px)";
        actionsPanel.style.gap = "6px";
        actionsPanel.style.alignItems = "center";
        actionsPanel.style.justifyContent = "center";

        const createActionButton = (label, onClick) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = label;
            button.style.flex = "1 1 0";
            button.style.maxWidth = "136px";
            button.style.height = "46px";
            button.style.padding = "0";
            button.style.border = "1px solid #5a8ee0";
            button.style.borderRadius = "12px";
            button.style.background = "linear-gradient(180deg, rgba(40,80,150,0.95) 0%, rgba(16,45,105,0.95) 100%)";
            button.style.color = "#d9e7ff";
            button.style.cursor = "pointer";
            button.style.fontWeight = "700";
            button.style.letterSpacing = "0.2px";
            button.style.userSelect = "none";
            button.addEventListener("click", onClick);
            return button;
        };

        const autogensBtn = createActionButton("Autogens", () => {
            this.core.buildingManager.autoPlaceGenerators();
        });
        const externatkBtn = createActionButton("ExternaTK", () => {
            this.core.buildingManager.placeExternalAtkArmory();
        });
        const saveBaseBtn = createActionButton("Save Base", () => {
            this.showSaveBaseLayoutDialog();
        });
        const loadBaseBtn = createActionButton("Load Base", () => {
            this.showLoadBaseLayoutDialog();
        });

        const showActions = () => {
            pullTab.style.display = "none";
            actionsPanel.style.display = "flex";
        };
        const showMenu = () => {
            actionsPanel.style.display = "none";
            pullTab.style.display = "block";
        };

        // Hover swap behavior: MENU is replaced by action buttons in the same area.
        container.addEventListener("mouseenter", showActions);
        container.addEventListener("mouseleave", showMenu);

        actionsPanel.appendChild(autogensBtn);
        actionsPanel.appendChild(externatkBtn);
        actionsPanel.appendChild(saveBaseBtn);
        actionsPanel.appendChild(loadBaseBtn);
        container.appendChild(pullTab);
        container.appendChild(actionsPanel);
        gameContainer.appendChild(container);
    }

    addChatButtonElementListener () {
        if (!this.DOM.chat.button || !this.DOM.chat.input) return;

        this.DOM.chat.button.addEventListener("click", () => {
            const message = this.DOM.chat.input.value.trim();
            if (message === this.lastSendMessage) {
                this.DOM.chat.input.value = ""; // Clear input
                this.addChatMessage("System", "Stop Spamming!");
                this.disableChatButtonElementForSeconds(5); // Disable button for 5 seconds

            } else if (message) {
                this.DOM.chat.input.value = ""; // Clear input
                this.core.networkManager.sendChatMessage(message);
                this.lastSendMessage = message;
                this.disableChatButtonElementForSeconds(5); // Disable button for 5 seconds
            }
        });

        this.DOM.chat.input.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                event.preventDefault(); // Prevent default enter key behavior
                this.DOM.chat.button.click(); // Trigger chat button click
            }
        });
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

        this.DOM.menu.playButton.addEventListener("click", () => {
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

            // Normalize to byte range
            equippedSkinByte = Math.max(0, Math.min(255, equippedSkinByte));

            console.log('Joining game with skin (byte):', equippedSkinByte, 'name:', equippedSkinName);
            this.core.handlePlayButtonPress(playerName, equippedSkinByte);
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

    addSkinLibraryButtonListener () {
        if (this.DOM.skins.libraryExit) {
            this.DOM.skins.libraryExit.addEventListener("click", () => {
                this.showSkinLibraryDialog(false);
            });
        }
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
                this.showGameSettingsButton(true)
                this.showGameSettingsPanel(false)
            });
        }

        this.DOM.settings.themeSelect.addEventListener("change", (event) => {
            this.core.themeManager.applyTheme(event.target.value);
        });
    }

    extractPlayerName () {
        const isLoggedIn = this.core.networkManager.loggedIn;
        const userData = this.core.networkManager.userData;

        if (isLoggedIn && userData && userData.nickname) {
            return userData.nickname;
        }

        if (isLoggedIn) {
            try {
                const cachedUser = localStorage.getItem('blobl_user_data');
                if (cachedUser) {
                    const parsedUser = JSON.parse(cachedUser);
                    if (parsedUser && parsedUser.nickname) {
                        return parsedUser.nickname;
                    }
                }
            } catch (e) {}
        }

        const defaultNames = ["◕‿↼", "•◡•", "(ㆆ _ ㆆ)", "ಠ╭╮ಠ", "(• ε •)",
            "⇀‸↼‶", "◔̯◔", "◉‿◉", "•`_´•", "-_-",
            "⌐■_■", "•_•", "ಠ_ರೃ", "´◔ ω◔`", "♥‿♥", "⊙＿⊙'", "⊙ω⊙", "> _ <"
        ];
        let playerName = this.DOM.menu.playerNameInput.value.trim();

        if (!playerName) {
            // Pick a random name from the defaultNames array
            playerName = defaultNames[Math.floor(Math.random() * defaultNames.length)];
        } else {
            // Limit to 12 bytes
            const encoder = new TextEncoder();
            let encodedName = encoder.encode(playerName);

            if (encodedName.length > 12) {
                playerName = playerName.slice(0, 12); // Initial cut to 12 characters
                encodedName = encoder.encode(playerName);
                while (encodedName.length > 12 && playerName.length > 0) {
                    playerName = playerName.slice(0, -1); // Trim from the end
                    encodedName = encoder.encode(playerName);
                }
            }
        }

        return playerName;
    }

    showMenuContainer (show) {
        this.core.camera.enableControls(!show)
        this.DOM.menu.screen.style.display = show ? "flex" : "none";
    }

    showGameOverContainer (show) {
        this.core.camera.enableControls(!show)
        this.DOM.game.over.container.style.display = show ? "flex" : "none";
    }

    showChat (show) {
        this.DOM.chat.container.style.display = show ? "flex" : "none";
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
        this.showSpawnProtectionTimer(show);
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
    }

    showGameUIElements (show) {
        this.menuOpen = !show;
        this.showLeaderboard(show);
        this.showToolbar(show);
        this.showUnitControls(show);
        this.showResource(show);
        this.showChat(show);
        this.showMetrics(show);
        this.showMiniMap(show);
        const autoBuildMenu = document.getElementById("autobuild-menu-container");
        if (autoBuildMenu) {
            autoBuildMenu.style.display = show ? "flex" : "none";
        }
    }

    showGameOverUIElements (show) {
        this.hideUpgrades();
        this.showGameOverContainer(show);
    }

    showMenuDialog (title, message1, message2 = "", message3 = "", buttonText = "Okay") {
        const dialog = document.getElementById("menu-dialog");
        const dialogTitle = dialog.querySelector("h2");
        const dialogMessages = dialog.querySelectorAll("p");
        const dialogButton = document.getElementById("menu-dialog-button");

        if (dialog) {
            //! Just keep the html content for now
            //   dialogTitle.textContent = title;
            //  dialogMessages[0].textContent = message1;
            //  dialogMessages[1].innerHTML = message2;
            //   dialogMessages[2].innerHTML = message3;
            //   dialogButton.textContent = buttonText;
            dialog.style.display = "flex";
        }
    }

    hideMenuDialog () {
        const dialog = document.getElementById("menu-dialog");
        if (dialog) {
            dialog.style.display = "none";
        }
    }

    updateResources () {
        const { power, protectionTime } = this.core.gameManager.resources;
        const protectionTimeDisplay = protectionTime.current > 0
            ? `${protectionTime.current}min`
            : "<1min";

        this.DOM.game.resources.power.innerHTML = `Power: <span>${power.current}/${power.max} (+${power.generationRate}/s)</span>`;
        this.DOM.game.resources.shield.innerHTML = `Protection: <span>${protectionTimeDisplay}</span>`;


        this._updateCost(); // Update the upgrade panel
    }

    showSpawnProtectionTimer (show) {
        if (!this.DOM.game.resources.shield) return;
        this.DOM.game.resources.shield.style.display = show ? "flex" : "none";
    }

    showMetrics (show) {
        this.DOM.game.metrics.style.display = show ? "flex" : "none";
    }

    showGameSettingsButton (show) {
        this.DOM.settings.button.style.display = show ? "flex" : "none";
    }

    showGameSettingsPanel (show) {
        this.DOM.settings.panel.style.display = show ? "flex" : "none";
    }

    showMiniMap (show) {
        this.DOM.game.miniMap.style.display = show ? "flex" : "none";
    }

    showLoginDialog (show) {
        this.DOM.account.loginDialog.style.display = show ? "flex" : "none";
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
        this.core.camera.setPosition(killer.position, true);
        this.core.camera.setZoom(0.75);

        this.updateGameOverStats(killer.name, score);

        this.showGameUIElements(false);
        this.showGameOverUIElements(true);
    }

    kicked (reason, score) {
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
                    message = `Grab a snack, server's rebooting in ${minutesLeft}m ${secondsLeft}s! 🍪`;
                } else {
                    message = `Server's about to reboot in ${secondsLeft}s! ⏳`;
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

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0, 0, 0, 0.55)";
        overlay.style.zIndex = "20000";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.pointerEvents = "all";

        const card = document.createElement("div");
        card.style.width = "min(520px, 92vw)";
        card.style.background = "linear-gradient(145deg, rgba(8,18,40,0.96), rgba(20,40,80,0.96))";
        card.style.border = "2px solid rgba(100, 190, 255, 0.65)";
        card.style.borderRadius = "14px";
        card.style.padding = "22px 24px";
        card.style.boxShadow = "0 18px 55px rgba(0,0,0,0.55), 0 0 25px rgba(96,193,255,0.25)";
        card.style.color = "#eaf6ff";
        card.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "1v1 CHALLENGE";
        title.style.fontSize = "22px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "1.1px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = `${challengerName} has challenged you to a 1v1.`;
        subtitle.style.marginTop = "10px";
        subtitle.style.fontSize = "18px";
        subtitle.style.fontWeight = "700";
        subtitle.style.color = "#ffffff";

        const description = document.createElement("div");
        description.textContent = "Do you want to accept this duel now?";
        description.style.marginTop = "8px";
        description.style.fontSize = "14px";
        description.style.opacity = "0.92";

        const actions = document.createElement("div");
        actions.style.marginTop = "20px";
        actions.style.display = "flex";
        actions.style.gap = "12px";
        actions.style.justifyContent = "flex-end";

        const declineButton = document.createElement("button");
        declineButton.type = "button";
        declineButton.textContent = "Decline";
        declineButton.style.border = "1px solid rgba(255, 120, 120, 0.65)";
        declineButton.style.background = "rgba(150, 30, 30, 0.25)";
        declineButton.style.color = "#ffd6d6";
        declineButton.style.fontSize = "14px";
        declineButton.style.fontWeight = "700";
        declineButton.style.padding = "10px 16px";
        declineButton.style.borderRadius = "10px";
        declineButton.style.cursor = "pointer";

        const acceptButton = document.createElement("button");
        acceptButton.type = "button";
        acceptButton.textContent = "Accept";
        acceptButton.style.border = "1px solid rgba(120, 255, 165, 0.75)";
        acceptButton.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
        acceptButton.style.color = "#e8ffef";
        acceptButton.style.fontSize = "14px";
        acceptButton.style.fontWeight = "800";
        acceptButton.style.padding = "10px 18px";
        acceptButton.style.borderRadius = "10px";
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
        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(description);
        card.appendChild(actions);
        overlay.appendChild(card);

        document.body.appendChild(overlay);
        this.x1PromptElement = overlay;
    }

    hideX1ChallengePrompt() {
        if (this.x1PromptElement && this.x1PromptElement.parentNode) {
            this.x1PromptElement.parentNode.removeChild(this.x1PromptElement);
        }
        this.x1PromptElement = null;
    }

    showX1SendPrompt(targetName, onConfirm, onCancel) {
        this.hideX1ChallengePrompt();
        this.hideX1SendPrompt();
        this.hideEnemyCoreActions();

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0, 0, 0, 0.45)";
        overlay.style.zIndex = "19999";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.pointerEvents = "all";

        const card = document.createElement("div");
        card.style.width = "min(500px, 90vw)";
        card.style.background = "linear-gradient(145deg, rgba(9,17,34,0.96), rgba(16,30,58,0.96))";
        card.style.border = "2px solid rgba(102, 225, 255, 0.65)";
        card.style.borderRadius = "14px";
        card.style.padding = "22px 24px";
        card.style.boxShadow = "0 16px 45px rgba(0,0,0,0.55), 0 0 22px rgba(96,193,255,0.23)";
        card.style.color = "#eaf6ff";
        card.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "CHALLENGE X1";
        title.style.fontSize = "22px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "1px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = `Challenge ${targetName} to a protected 1v1?`;
        subtitle.style.marginTop = "10px";
        subtitle.style.fontSize = "18px";
        subtitle.style.fontWeight = "700";
        subtitle.style.color = "#ffffff";

        const description = document.createElement("div");
        description.textContent = "If accepted, a protected arena will appear for both players.";
        description.style.marginTop = "8px";
        description.style.fontSize = "14px";
        description.style.opacity = "0.92";

        const actions = document.createElement("div");
        actions.style.marginTop = "20px";
        actions.style.display = "flex";
        actions.style.gap = "12px";
        actions.style.justifyContent = "flex-end";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Cancel";
        cancelButton.style.border = "1px solid rgba(255, 130, 130, 0.65)";
        cancelButton.style.background = "rgba(120, 36, 36, 0.25)";
        cancelButton.style.color = "#ffd6d6";
        cancelButton.style.fontSize = "14px";
        cancelButton.style.fontWeight = "700";
        cancelButton.style.padding = "10px 16px";
        cancelButton.style.borderRadius = "10px";
        cancelButton.style.cursor = "pointer";

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.textContent = "Challenge";
        confirmButton.style.border = "1px solid rgba(120, 255, 165, 0.75)";
        confirmButton.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
        confirmButton.style.color = "#e8ffef";
        confirmButton.style.fontSize = "14px";
        confirmButton.style.fontWeight = "800";
        confirmButton.style.padding = "10px 18px";
        confirmButton.style.borderRadius = "10px";
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
        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(description);
        card.appendChild(actions);
        overlay.appendChild(card);

        document.body.appendChild(overlay);
        this.x1SendPromptElement = overlay;
    }

    hideX1SendPrompt() {
        if (this.x1SendPromptElement && this.x1SendPromptElement.parentNode) {
            this.x1SendPromptElement.parentNode.removeChild(this.x1SendPromptElement);
        }
        this.x1SendPromptElement = null;
    }

    showEnemyCoreActions(targetName, onChallengeX1, onNotifyLeaveBase, onCancel) {
        this.hideX1ChallengePrompt();
        this.hideX1SendPrompt();
        this.hideEnemyCoreActions();

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0, 0, 0, 0.45)";
        overlay.style.zIndex = "19999";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.pointerEvents = "all";

        const card = document.createElement("div");
        card.style.width = "min(560px, 92vw)";
        card.style.background = "linear-gradient(145deg, rgba(9,17,34,0.96), rgba(16,30,58,0.96))";
        card.style.border = "2px solid rgba(102, 225, 255, 0.65)";
        card.style.borderRadius = "14px";
        card.style.padding = "22px 24px";
        card.style.boxShadow = "0 16px 45px rgba(0,0,0,0.55), 0 0 22px rgba(96,193,255,0.23)";
        card.style.color = "#eaf6ff";
        card.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "Enemy Base";
        title.style.fontSize = "22px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "1px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = targetName || "Player";
        subtitle.style.marginTop = "8px";
        subtitle.style.fontSize = "18px";
        subtitle.style.fontWeight = "700";
        subtitle.style.color = "#ffffff";

        const actions = document.createElement("div");
        actions.style.marginTop = "16px";
        actions.style.display = "grid";
        actions.style.gap = "10px";

        const createActionButton = (label, description, clickHandler) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.style.width = "100%";
            btn.style.textAlign = "left";
            btn.style.border = "1px solid rgba(116, 212, 255, 0.55)";
            btn.style.background = "rgba(20, 44, 82, 0.55)";
            btn.style.color = "#eaf6ff";
            btn.style.borderRadius = "10px";
            btn.style.padding = "12px 14px";
            btn.style.cursor = "pointer";
            btn.style.display = "block";
            btn.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

            const t = document.createElement("div");
            t.textContent = label;
            t.style.fontSize = "15px";
            t.style.fontWeight = "800";

            const d = document.createElement("div");
            d.textContent = description;
            d.style.marginTop = "4px";
            d.style.fontSize = "13px";
            d.style.opacity = "0.9";

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
        cancelRow.style.marginTop = "14px";
        cancelRow.style.display = "flex";
        cancelRow.style.justifyContent = "flex-end";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Close";
        cancelButton.style.border = "1px solid rgba(255, 130, 130, 0.65)";
        cancelButton.style.background = "rgba(120, 36, 36, 0.25)";
        cancelButton.style.color = "#ffd6d6";
        cancelButton.style.fontSize = "14px";
        cancelButton.style.fontWeight = "700";
        cancelButton.style.padding = "10px 16px";
        cancelButton.style.borderRadius = "10px";
        cancelButton.style.cursor = "pointer";
        cancelButton.addEventListener("click", () => {
            this.hideEnemyCoreActions();
            if (typeof onCancel === "function") onCancel();
        });
        cancelRow.appendChild(cancelButton);

        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(actions);
        card.appendChild(cancelRow);
        overlay.appendChild(card);

        document.body.appendChild(overlay);
        this.enemyCoreActionsElement = overlay;
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

    captureCurrentBaseSnapshot () {
        const canvas = this.core?.canvas;
        const player = this.core?.gameManager?.player;
        const camera = this.core?.camera;
        if (!canvas) return null;

        try {
            if (!player || !camera) {
                return canvas.toDataURL("image/jpeg", 0.75);
            }

            const zoom = camera.zoom || 1;
            const centerX = (player.position.x - camera.x) * zoom + canvas.width / 2;
            const centerY = (player.position.y - camera.y) * zoom + canvas.height / 2;
            const worldCaptureRadius = 460;
            const targetSize = Math.max(180, Math.min(canvas.width, canvas.height, Math.round(worldCaptureRadius * 2 * zoom)));

            const sx = Math.max(0, Math.min(canvas.width - targetSize, Math.round(centerX - targetSize / 2)));
            const sy = Math.max(0, Math.min(canvas.height - targetSize, Math.round(centerY - targetSize / 2)));

            const offscreen = document.createElement("canvas");
            offscreen.width = targetSize;
            offscreen.height = targetSize;
            const context = offscreen.getContext("2d");
            if (!context) {
                return canvas.toDataURL("image/jpeg", 0.75);
            }
            context.drawImage(canvas, sx, sy, targetSize, targetSize, 0, 0, targetSize, targetSize);
            return offscreen.toDataURL("image/jpeg", 0.8);
        } catch (error) {
            console.error("Could not capture base snapshot:", error);
            return null;
        }
    }

    hideBaseLayoutDialog () {
        if (this.baseLayoutDialogElement && this.baseLayoutDialogElement.parentNode) {
            this.baseLayoutDialogElement.parentNode.removeChild(this.baseLayoutDialogElement);
        }
        this.baseLayoutDialogElement = null;
    }

    showSaveBaseLayoutDialog () {
        this.hideBaseLayoutDialog();

        const snapshot = this.captureCurrentBaseSnapshot();
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
        subtitle.textContent = "Name your base layout and save it for later use.";
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

        let previewElement = null;
        if (snapshot) {
            const preview = document.createElement("img");
            preview.src = snapshot;
            preview.alt = "Base snapshot";
            preview.style.display = "block";
            preview.style.width = "100%";
            preview.style.maxHeight = "260px";
            preview.style.objectFit = "cover";
            preview.style.marginTop = "12px";
            preview.style.borderRadius = "10px";
            preview.style.border = "1px solid rgba(120, 180, 255, 0.45)";
            previewElement = preview;
        }

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
        save.addEventListener("click", () => {
            const layout = this.core.buildingManager.exportCurrentBaseLayout(input.value, snapshot);
            if (!layout) {
                this.addChatMessage("System", "Could not save base right now.", "#ffcc66");
                return;
            }
            const existing = this.getSavedBaseLayouts().slice(0, 29);
            this.setSavedBaseLayouts([layout, ...existing]);
            this.addChatMessage("System", `Base "${layout.name}" saved.`, "#60c1ff");

            if (publishCheckbox.checked) {
                const userId = this.core.networkManager?.userId || null;
                const authorName = this.core.gameManager?.player?.name || this.core.networkManager?.userData?.nickname || "Guest";
                publishBaseLayout({
                    userId,
                    authorName,
                    name: layout.name,
                    snapshot: layout.snapshot,
                    buildings: layout.buildings,
                    isPublic: true
                }).then(result => {
                    if (result.success) {
                        this.addChatMessage("System", `Base "${layout.name}" published.`, "#7CFC00");
                    } else {
                        this.addChatMessage("System", "Could not publish base (check DB table/config).", "#ffcc66");
                    }
                });
            }

            this.hideBaseLayoutDialog();
        });

        actions.appendChild(cancel);
        actions.appendChild(save);
        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(input);
        card.appendChild(publishRow);
        if (previewElement) {
            card.appendChild(previewElement);
        }
        card.appendChild(actions);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        this.baseLayoutDialogElement = overlay;
        input.focus();
        input.select();
    }

    showLoadBaseLayoutDialog () {
        this.hideBaseLayoutDialog();

        const localLayouts = this.getSavedBaseLayouts();
        let publicLayouts = [];
        let activeSource = "local";

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

        const list = document.createElement("div");
        list.style.marginTop = "12px";
        list.style.maxHeight = "62vh";
        list.style.overflowY = "auto";
        list.style.display = "grid";
        list.style.gap = "10px";
        list.style.paddingRight = "4px";

        const normalizeLayout = (layout) => ({
            id: layout.id,
            name: layout.name || "Unnamed Base",
            snapshot: layout.snapshot || null,
            createdAt: layout.createdAt || layout.created_at || null,
            authorName: layout.author_name || "",
            buildings: Array.isArray(layout.buildings)
                ? layout.buildings
                : (Array.isArray(layout?.layout_json?.buildings) ? layout.layout_json.buildings : [])
        });

        const renderLayouts = async (queryText = "") => {
            list.innerHTML = "";
            const query = (queryText || "").trim();
            let filtered = [];

            if (activeSource === "public") {
                const response = await fetchPublicBaseLayouts(query, 40);
                if (!response.success) {
                    const errorInfo = document.createElement("div");
                    errorInfo.textContent = "Could not load public bases.";
                    errorInfo.style.padding = "14px";
                    errorInfo.style.border = "1px dashed rgba(255, 140, 140, 0.45)";
                    errorInfo.style.borderRadius = "10px";
                    errorInfo.style.opacity = "0.9";
                    list.appendChild(errorInfo);
                    return;
                }
                publicLayouts = (response.data || []).map(normalizeLayout);
                filtered = publicLayouts;
            } else {
                const q = query.toLowerCase();
                filtered = !q
                    ? localLayouts.map(normalizeLayout)
                    : localLayouts.map(normalizeLayout).filter(layout => layout.name.toLowerCase().includes(q));
            }

            if (filtered.length === 0) {
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
                const item = document.createElement("div");
                item.style.display = "grid";
                item.style.gridTemplateColumns = "180px 1fr auto";
                item.style.gap = "10px";
                item.style.alignItems = "center";
                item.style.padding = "10px";
                item.style.border = "1px solid rgba(120, 180, 255, 0.4)";
                item.style.borderRadius = "10px";
                item.style.background = "rgba(10, 22, 48, 0.55)";

                const preview = document.createElement("div");
                preview.style.width = "180px";
                preview.style.height = "100px";
                preview.style.borderRadius = "8px";
                preview.style.overflow = "hidden";
                preview.style.border = "1px solid rgba(120, 180, 255, 0.35)";
                preview.style.background = "rgba(4, 12, 28, 0.7)";

                if (layout.snapshot) {
                    const img = document.createElement("img");
                    img.src = layout.snapshot;
                    img.alt = layout.name || "Base";
                    img.style.width = "100%";
                    img.style.height = "100%";
                    img.style.objectFit = "cover";
                    preview.appendChild(img);
                }

                const info = document.createElement("div");
                const name = document.createElement("div");
                name.textContent = layout.name || "Unnamed Base";
                name.style.fontSize = "16px";
                name.style.fontWeight = "800";
                const meta = document.createElement("div");
                const created = layout.createdAt ? new Date(layout.createdAt).toLocaleString() : "Unknown date";
                const count = Array.isArray(layout.buildings) ? layout.buildings.length : 0;
                const author = layout.authorName ? ` by ${layout.authorName}` : "";
                meta.textContent = `${count} buildings • ${created}${author}`;
                meta.style.marginTop = "6px";
                meta.style.fontSize = "12px";
                meta.style.opacity = "0.86";
                info.appendChild(name);
                info.appendChild(meta);

                const actions = document.createElement("div");
                actions.style.display = "grid";
                actions.style.gap = "8px";

                const loadBtn = document.createElement("button");
                loadBtn.textContent = "Load";
                loadBtn.style.border = "1px solid rgba(120, 255, 165, 0.75)";
                loadBtn.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
                loadBtn.style.color = "#e8ffef";
                loadBtn.style.padding = "8px 12px";
                loadBtn.style.borderRadius = "9px";
                loadBtn.style.cursor = "pointer";
                loadBtn.style.fontWeight = "800";
                loadBtn.addEventListener("click", () => {
                    this.hideBaseLayoutDialog();
                    this.core.buildingManager.loadBaseLayout(layout);
                });

                actions.appendChild(loadBtn);
                if (activeSource === "local") {
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
                        publishBtn.disabled = true;
                        const oldText = publishBtn.textContent;
                        publishBtn.textContent = "Publishing...";
                        try {
                            const userId = this.core.networkManager?.userId || null;
                            const authorName = this.core.gameManager?.player?.name || this.core.networkManager?.userData?.nickname || "Guest";
                            const result = await publishBaseLayout({
                                userId,
                                authorName,
                                name: layout.name,
                                snapshot: layout.snapshot,
                                buildings: layout.buildings,
                                isPublic: true
                            });
                            if (result?.success) {
                                this.addChatMessage("System", `Base "${layout.name}" published.`, "#7CFC00");
                            } else {
                                this.addChatMessage("System", "Could not publish base (check DB table/config).", "#ffcc66");
                            }
                        } catch (error) {
                            this.addChatMessage("System", "Could not publish base (network error).", "#ffcc66");
                        } finally {
                            publishBtn.disabled = false;
                            publishBtn.textContent = oldText;
                        }
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
                        const remaining = this.getSavedBaseLayouts().filter(item => item.id !== layout.id);
                        this.setSavedBaseLayouts(remaining);
                        this.showLoadBaseLayoutDialog();
                    });
                    actions.appendChild(publishBtn);
                    actions.appendChild(deleteBtn);
                }

                item.appendChild(preview);
                item.appendChild(info);
                item.appendChild(actions);
                list.appendChild(item);
            });
        };

        searchInput.addEventListener("input", async () => {
            await renderLayouts(searchInput.value);
        });
        renderLayouts();

        const closeRow = document.createElement("div");
        closeRow.style.marginTop = "12px";
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
        card.appendChild(list);
        card.appendChild(closeRow);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        this.baseLayoutDialogElement = overlay;
        searchInput.focus();
    }

    showRelocateBasePrompt(cost, onConfirm, onCancel) {
        this.hideRelocateBasePrompt();

        const overlay = document.createElement("div");
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0, 0, 0, 0.45)";
        overlay.style.zIndex = "19999";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.pointerEvents = "all";

        const card = document.createElement("div");
        card.style.width = "min(500px, 90vw)";
        card.style.background = "linear-gradient(145deg, rgba(9,17,34,0.96), rgba(16,30,58,0.96))";
        card.style.border = "2px solid rgba(102, 225, 255, 0.65)";
        card.style.borderRadius = "14px";
        card.style.padding = "22px 24px";
        card.style.boxShadow = "0 16px 45px rgba(0,0,0,0.55), 0 0 22px rgba(96,193,255,0.23)";
        card.style.color = "#eaf6ff";
        card.style.fontFamily = "'Ubuntu', 'Trebuchet MS', sans-serif";

        const title = document.createElement("div");
        title.textContent = "RELOCATE BASE";
        title.style.fontSize = "22px";
        title.style.fontWeight = "900";
        title.style.letterSpacing = "1px";
        title.style.color = "#9fe8ff";

        const subtitle = document.createElement("div");
        subtitle.textContent = `Confirm relocation for ${cost} power?`;
        subtitle.style.marginTop = "10px";
        subtitle.style.fontSize = "18px";
        subtitle.style.fontWeight = "700";
        subtitle.style.color = "#ffffff";

        const description = document.createElement("div");
        description.textContent = "Your base and owned entities will move to the selected empty slot.";
        description.style.marginTop = "8px";
        description.style.fontSize = "14px";
        description.style.opacity = "0.92";

        const actions = document.createElement("div");
        actions.style.marginTop = "20px";
        actions.style.display = "flex";
        actions.style.gap = "12px";
        actions.style.justifyContent = "flex-end";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Cancel";
        cancelButton.style.border = "1px solid rgba(255, 130, 130, 0.65)";
        cancelButton.style.background = "rgba(120, 36, 36, 0.25)";
        cancelButton.style.color = "#ffd6d6";
        cancelButton.style.fontSize = "14px";
        cancelButton.style.fontWeight = "700";
        cancelButton.style.padding = "10px 16px";
        cancelButton.style.borderRadius = "10px";
        cancelButton.style.cursor = "pointer";

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.textContent = "Relocate";
        confirmButton.style.border = "1px solid rgba(120, 255, 165, 0.75)";
        confirmButton.style.background = "linear-gradient(135deg, rgba(33, 180, 118, 0.55), rgba(41, 225, 132, 0.35))";
        confirmButton.style.color = "#e8ffef";
        confirmButton.style.fontSize = "14px";
        confirmButton.style.fontWeight = "800";
        confirmButton.style.padding = "10px 18px";
        confirmButton.style.borderRadius = "10px";
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
        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(description);
        card.appendChild(actions);
        overlay.appendChild(card);

        document.body.appendChild(overlay);
        this.relocatePromptElement = overlay;
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
        this.DOM.game.inactivityWarning.container.style.display = 'flex';
        let timeLeft = this.inactivityTimeout;

        const updateTimer = () => {
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            this.DOM.game.inactivityWarning.timer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            if (timeLeft <= 0) {
                clearInterval(this.inactivityTimerInterval);
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

