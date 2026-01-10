import { BuildingTypes, calculateRequiredXP, getAvailableBuildingUpgrades, getBuildingDetails, getColorForLevel, Servers, UnitTypes } from "../../network/constants.js";
import Network from "../../network/Network.js";
import SkinCache from "../SkinCache.js";
import { signUp, signIn, getCurrentUser, fetchSkins, updateSelectedSkin } from "../../network/supabaseClient.js";
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
        
        // Skin navigation properties
        this.currentSkinIndex = 0;
        this.availableSkins = [];

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

                    this.availableSkins = [
                        { name: 'Default', id: 0, numericId: 0, url: null },
                        ...skins
                    ];
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
        
        // Initialize with default skin if no cache
        this.availableSkins = [{ name: 'Default', id: 0, numericId: 0, url: null }];
        this.currentSkinIndex = 0;
        this.updateSkinCircle();
        this.updateUseButton();
    }

    async loadSupabaseSkins() {
        try {
            const skins = await fetchSkins();
            if (skins.length > 0) {
                // Save to cache
                SkinCache.setSupabaseSkins(skins);
                console.log('Supabase skins fetched and cached:', skins.length);
                
                // Build available skins array (default + supabase skins)
                this.availableSkins = [
                    { name: 'Default', id: 0, numericId: 0, url: null },
                    ...skins
                ];
                
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
                // Only set default if we don't have cached skins
                console.warn('No Supabase skins found - using cached or default');
            }
        } catch (error) {
            console.error('Error loading Supabase skins:', error);
            // Keep whatever we have from cache
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
                    this.core.networkManager.checkLoginStatus();
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

    updateSkinCircle() {
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
            nameDisplay.textContent = currentSkin.name || 'Default';
            
            if (currentSkin.url) {
                img.src = currentSkin.url;
                img.style.display = 'block';
            } else {
                img.style.display = 'none';
            }
        }
        
        // Update button states
        if (prevBtn) {
            prevBtn.disabled = this.currentSkinIndex === 0;
        }
        if (nextBtn) {
            nextBtn.disabled = this.currentSkinIndex >= this.availableSkins.length - 1;
        }
        
        // Update Use button state
        this.updateUseButton();
    }
    
    updateUseButton() {
        const useBtn = document.getElementById('skin-use-button');
        if (!useBtn) return;
        
        const currentSkin = this.availableSkins[this.currentSkinIndex];
        const equippedSkinName = localStorage.getItem('equippedSkinName') || '';
        
        // Check if current viewing skin is the equipped one
        const isCurrentEquipped = 
            (currentSkin?.name === 'Default' && (!equippedSkinName || equippedSkinName === '')) ||
            (currentSkin?.name === equippedSkinName);
        
        if (isCurrentEquipped) {
            useBtn.textContent = 'Equipped ✓';
            useBtn.classList.add('selected');
        } else {
            useBtn.textContent = 'Use';
            useBtn.classList.remove('selected');
        }
    }
    
    addSkinNavigationListeners() {
        const prevBtn = document.getElementById('skin-carousel-prev-menu');
        const nextBtn = document.getElementById('skin-carousel-next-menu');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (this.currentSkinIndex > 0) {
                    this.currentSkinIndex--;
                    this.updateSkinCircle();
                }
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (this.currentSkinIndex < this.availableSkins.length - 1) {
                    this.currentSkinIndex++;
                    this.updateSkinCircle();
                }
            });
        }
    }
    
    addSkinUseButtonListener() {
        const useBtn = document.getElementById('skin-use-button');
        if (useBtn) {
            useBtn.addEventListener('click', () => {
                this.selectCurrentSkin();
            });
        }
    }
    
    async selectCurrentSkin() {
        const currentSkin = this.availableSkins[this.currentSkinIndex];
        if (!currentSkin) return;
        
        const skinName = currentSkin.name === 'Default' ? null : currentSkin.name;
        const skinNumeric = currentSkin.numericId ?? currentSkin.id ?? 0;

        // Save to localStorage (name for DB/UI, numeric for network byte)
        localStorage.setItem('equippedSkin', skinNumeric);
        localStorage.setItem('equippedSkinName', skinName || '');
        
        console.log('Skin equipped:', skinName);
        
        // Update Use button immediately
        this.updateUseButton();
        
        // If logged in, save to database
        const isLoggedIn = this.core.networkManager.loggedIn;
        const userId = this.core.networkManager.userId;
        
        if (isLoggedIn && userId) {
            try {
                await updateSelectedSkin(userId, skinName);
                console.log('Skin saved to database');
                
                if (this.core.networkManager.userData) {
                    this.core.networkManager.userData.selected_skin = skinName;
                }
            } catch (error) {
                console.error('Error saving skin to database:', error);
            }
        }
        
        // Update library if open
        this.populateSkinLibrary();
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
            const upgradeHotkeys = ["Q", "E", "T"];

            const getAvailableUpgrades = () => {
                return getAvailableBuildingUpgrades(building.type, building.variant);
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
                    const unitType = this.selectedUpgradeTab;
                    const UnitClass = UnitManager.getUnitClassByType(unitType);
                    renderable = new UnitClass(building.color, { x: 0, y: 0 }, upgradeInfo.variant);
                } else {
                    const BuildingClass = BuildingManager.getBuildingClassByType(building.type);
                    renderable = new BuildingClass(building.color, { x: 0, y: 0 }, upgradeInfo.variant);
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
                    const upgradeData = isArmory
                        ? { unitType: this.selectedUpgradeTab, unitVariant: upgradeInfo.variant }
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