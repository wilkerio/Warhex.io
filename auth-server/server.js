// Importing required libraries
const express = require("express");
const axios = require("axios");
const { Client, GatewayIntentBits } = require("discord.js");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const admin = require("firebase-admin");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware setup
app.use(cookieParser()); // Middleware to parse cookies
app.use(express.json());

// Initialize Firebase Admin
const serviceAccount = require("./firebaseServiceAccountKey.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

// Initialize Firestore
const db = admin.firestore();

// Environment variables
const {
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    REDIRECT_URI,
    DISCORD_BOT_TOKEN,
    GUILD_ID,
    VERIFIED_CHANNEL_ID,
    ACHIEVEMENT_CHANNEL_ID,
    COMMANDS_CHANNEL_ID,
    VERIFIED_ROLE_ID,
    ACCESS_TOKEN_SECRET,
    REFRESH_TOKEN_SECRET,
    ACHIEVEMENT_500K_SCORE_ROLE_ID,
    ACHIEVEMENT_1M_SCORE_ROLE_ID,
    ACHIEVEMENT_3M_SCORE_ROLE_ID,
    ACHIEVEMENT_5M_SCORE_ROLE_ID,
    ACHIEVEMENT_10M_SCORE_ROLE_ID,
    ACHIEVEMENT_15M_SCORE_ROLE_ID,
    ACHIEVEMENT_20M_SCORE_ROLE_ID,
    ACHIEVEMENT_25M_SCORE_ROLE_ID,
    ACHIEVEMENT_30M_SCORE_ROLE_ID,
    ACHIEVEMENT_35M_SCORE_ROLE_ID,
    ACHIEVEMENT_40M_SCORE_ROLE_ID,
    ACHIEVEMENT_45M_SCORE_ROLE_ID,
    ACHIEVEMENT_50M_SCORE_ROLE_ID,
} = process.env;

const parseCSV = (value) => (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const configuredOrigins = parseCSV(process.env.CORS_ALLOWED_ORIGINS);
const allowedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "http://127.0.0.1:9090",
        "http://127.0.0.1:9091"
    ];

const APP_URL = (process.env.APP_URL || allowedOrigins[0] || "http://localhost:3000").trim();
const COOKIE_DOMAIN = (process.env.COOKIE_DOMAIN || "").trim();
const cookieDomainOption = COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {};
const isLocalOrigin = (origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "");
const isValidOrigin = (origin) => Boolean(origin) && (allowedOrigins.includes(origin) || isLocalOrigin(origin));

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || isValidOrigin(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
}));

const ROLES = ["admin", "moderator"];

const ACHIEVEMENTS = {
    "50M_SCORE": {
        roleId: ACHIEVEMENT_50M_SCORE_ROLE_ID,
        priority: 13,
        scoreRequired: 50000000
    },
    "45M_SCORE": {
        roleId: ACHIEVEMENT_45M_SCORE_ROLE_ID,
        priority: 12,
        scoreRequired: 45000000
    },
    "40M_SCORE": {
        roleId: ACHIEVEMENT_40M_SCORE_ROLE_ID,
        priority: 11,
        scoreRequired: 40000000
    },
    "35M_SCORE": {
        roleId: ACHIEVEMENT_35M_SCORE_ROLE_ID,
        priority: 10,
        scoreRequired: 35000000
    },
    "30M_SCORE": {
        roleId: ACHIEVEMENT_30M_SCORE_ROLE_ID,
        priority: 9,
        scoreRequired: 30000000
    },
    "25M_SCORE": {
        roleId: ACHIEVEMENT_25M_SCORE_ROLE_ID,
        priority: 8,
        scoreRequired: 25000000
    },
    "20M_SCORE": {
        roleId: ACHIEVEMENT_20M_SCORE_ROLE_ID,
        priority: 7,
        scoreRequired: 20000000
    },
    "15M_SCORE": {
        roleId: ACHIEVEMENT_15M_SCORE_ROLE_ID,
        priority: 6,
        scoreRequired: 15000000
    },
    "10M_SCORE": {
        roleId: ACHIEVEMENT_10M_SCORE_ROLE_ID,
        priority: 5,
        scoreRequired: 10000000
    },
    "5M_SCORE": {
        roleId: ACHIEVEMENT_5M_SCORE_ROLE_ID,
        priority: 4,
        scoreRequired: 5000000
    },
    "3M_SCORE": {
        roleId: ACHIEVEMENT_3M_SCORE_ROLE_ID,
        priority: 3,
        scoreRequired: 3000000
    },
    "1M_SCORE": {
        roleId: ACHIEVEMENT_1M_SCORE_ROLE_ID,
        priority: 2,
        scoreRequired: 1000000
    },
    "500K_SCORE": {
        roleId: ACHIEVEMENT_500K_SCORE_ROLE_ID,
        priority: 1,
        scoreRequired: 500000
    },
};

// Function to get role ID and priority for a specific achievement
function getAchievementDetails (achievement) {
    return ACHIEVEMENTS[achievement] || null;
}

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent]
});
client.login(DISCORD_BOT_TOKEN);

// Helper function to fetch player count from the game server
const getPlayerCount = async (port) => {
    try {
        const response = await axios.get(`http://127.0.0.1:${port}/playercount`);
        if (response.status === 200) {
            return response.data.player_count; // Adjust this based on your server's response format
        }
        // console.error(`Error fetching player count: ${response.status}`);
        return 0; // Return 0 if error occurs
    } catch (error) {
        // console.error(`Failed to fetch player count from port ${port}:`, error);
        return 0; // Return 0 in case of error
    }
};

// Function to update bot status with player count
const updateBotStatus = async () => {
    // Fetch player counts from all specified ports concurrently
    const ports = [8080, 8081];
    const playerCounts = await Promise.all(ports.map(port => getPlayerCount(port)));

    // Calculate the total player count across all ports
    let totalPlayerCount = playerCounts.reduce((acc, count) => acc + count, 0);

    // Determine the activity name based on the total player count
    let activityName;
    if (totalPlayerCount === 0) {
        activityName = "No players online";
    } else if (totalPlayerCount === 1) {
        activityName = "1 player currently playing";
    } else {
        activityName = `${totalPlayerCount} players currently playing`;
    }

    // Set the bot's presence
    await client.user.setPresence({
        activities: [
            {
                name: activityName, // Set the dynamic activity name
                type: 4,
            }
        ],
        status: 'online' // Set desired status (online, idle, dnd, invisible)
    });
};

// Set an interval to update the bot status every 60 seconds
client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);

    updateBotStatus(); // Call it once immediately
    setInterval(updateBotStatus, 10000); // Update every 10 seconds
});

// Listen for when a user joins the server
client.on("guildMemberAdd", async (member) => {
    try {
        // Check Firestore for the user based on their Discord ID
        const userRef = db.collection('users').doc(member.id);
        const doc = await userRef.get();

        if (doc.exists) {
            const userData = doc.data();
            const userAchievements = userData.achievements || {}; // Retrieve user's achievements

            // Get the achievement details for the user's score
            const achievement = getAchievementDetails(userAchievements.score);

            // Check if the achievement roleId is valid and if it exists in the guild
            if (achievement && achievement.roleId && member.guild.roles.cache.has(achievement.roleId)) {
                await member.roles.add(achievement.roleId);
                console.log(`Assigned achievement role ${achievement.role} (${achievement.roleId}) to user: ${member.id}`);
            } else {
                console.log(`No valid achievement role found for user: ${member.id}`);
            }

            // Add the "Verified" role
            await member.roles.add(VERIFIED_ROLE_ID);
            console.log(`Assigned Verified role to user: ${member.id}`);
        } else {
            console.log(`User ID ${member.id} not found in Firestore.`);
        }
    } catch (error) {
        console.error("Error assigning roles:", error);
    }
});

client.on("messageCreate", async (message) => {

    // Ignore messages from bots and messages not in the specified commands channel
    if (message.author.bot || message.channelId !== COMMANDS_CHANNEL_ID) return;

    // Check if the message starts with the command prefix
    if (!message.content.startsWith("/blobl")) return;

    // Parse the command arguments
    const args = message.content.trim().split(/\s+/);

    // Check if there are enough arguments
    if (args.length < 4) {
        return message.reply("Incorrect usage. Please specify a user mention and a role. Usage: `/blobl set @User role`.");
    }

    const command = args[1]?.toLowerCase();
    const userMention = args[2];
    const roleName = args[3]?.toLowerCase();

    // Validate command type, user mention, and role name
    if (command !== "set" || !userMention || !roleName) {
        return message.reply("Please specify a valid command, user mention, and role. Usage: `/blobl set @User role`.");
    }

    // Check if the role is valid
    if (!ROLES.includes(roleName)) {
        return message.reply(`Invalid role specified. Valid roles are: ${ROLES.join(", ")}.`);
    }

    // Extract the user ID from the mention
    const userId = userMention.replace(/[<@!>]/g, "");

    try {
        const userRef = db.collection("users").doc(userId);
        const userSnapshot = await userRef.get();

        // Check if user exists in the database
        if (!userSnapshot.exists) {
            return message.reply("User not verified.");
        }

        // Update the user's role
        await userRef.update({ role: roleName });

        message.reply(`Successfully updated ${userMention}'s role to ${roleName}.`);
    } catch (error) {
        console.error("Error updating role in Firebase:", error);
        message.reply("There was an error updating the role in the database.");
    }
});

// Helper functions for token generation and cookie management
const generateAccessToken = (userId) => {
    return jwt.sign({ userId }, ACCESS_TOKEN_SECRET, { expiresIn: "15m" });
};

const generateRefreshToken = (userId) => {
    return jwt.sign({ userId }, REFRESH_TOKEN_SECRET, { expiresIn: "7d" });
};

const setTokens = (res, accessToken, refreshToken) => {
    res.cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000,
        path: "/",
        ...cookieDomainOption,
    });

    res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
        ...cookieDomainOption,
    });
};

// Middleware to authenticate requests using the access token
const authenticateToken = async (req, res, next) => {
    const accessToken = req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;

    // Helper function to refresh tokens
    const refreshTokens = async (userId) => {
        const newAccessToken = generateAccessToken(userId);
        const newRefreshToken = generateRefreshToken(userId);
        setTokens(res, newAccessToken, newRefreshToken);
        return { newAccessToken, newRefreshToken };
    };

    // If access token is missing, attempt to use refresh token
    if (!accessToken) {
        if (!refreshToken) {
            return res.status(401).send("Access token missing");
        }
        try {
            const refreshUser = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
            const { newAccessToken } = await refreshTokens(refreshUser.userId);
            req.user = refreshUser;
            return next();
        } catch (error) {
            console.error("Refresh token error:", error);
            return res.status(403).send("Invalid or expired refresh token");
        }
    }

    // Verify the access token
    jwt.verify(accessToken, ACCESS_TOKEN_SECRET, async (err, user) => {
        if (err) {
            if (err.name === 'TokenExpiredError' && refreshToken) {
                try {
                    const refreshUser = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
                    await refreshTokens(refreshUser.userId);
                    req.user = refreshUser;
                    return next();
                } catch (refreshError) {
                    console.error("Refresh token error:", refreshError);
                    return res.status(403).send("Invalid or expired refresh token");
                }
            } else {
                console.error("Access token error:", err);
                return res.status(403).send("Invalid or expired access token");
            }
        } else {
            req.user = user; // Attach user info and proceed
            next();
        }
    });
};

// Function to assign a role to a Discord user
const assignRole = async (userId, roleId) => {
    try {
        const response = await axios.put(`https://discord.com/api/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`, {}, {
            headers: {
                Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
                "Content-Type": "application/json",
            },
        });

        if (response.status === 204) {
            console.log(`Assigned role ${roleId} to user: ${userId}`);
            return true;
        } else {
            console.error("Failed to assign role:", response.data);
            return false;
        }
    } catch (error) {
        console.error("Error assigning role:", error.message);
        return false;
    }
};

// Handle Discord OAuth2 callback
app.get("/discord/callback", async (req, res) => {
    const code = req.query.code; // Get the authorization code from the query string

    if (!code) {
        return res.status(400).send("Missing authorization code.");
    }

    try {
        // Exchange the authorization code for an access token
        const response = await axios.post("https://discord.com/api/oauth2/token", new URLSearchParams({
            client_id: DISCORD_CLIENT_ID,
            client_secret: DISCORD_CLIENT_SECRET,
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
        });

        const accessTokenDiscord = response.data.access_token; // Get the access token from the response

        // Use the access token to get user information
        const userResponse = await axios.get("https://discord.com/api/users/@me", {
            headers: {
                Authorization: `Bearer ${accessTokenDiscord}`,
            },
        });

        const user = userResponse.data; // Get user data

        // Check if the user already exists in Firestore
        const userRef = db.collection('users').doc(user.id);
        const doc = await userRef.get();
        if (!doc.exists) {
            // User does not exist, create a new user document
            await userRef.set({
                discord: {
                    id: user.id,
                    username: user.username
                },
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                progression: {
                    level: 1,
                    xp: 0,
                },
                role: "user",
                statistics: {
                    highscore: "0",
                    kills: 0,
                    playtime: 0
                }
            });
            console.log(`New user added to Firestore: ${user.username}`);
            // Send a message to the verified channel
            const channel = await client.channels.fetch(VERIFIED_CHANNEL_ID);
            if (channel) {
                channel.send(`ðŸŽ‰ <@${user.id}> has successfully linked their Discord account to Blobl.io! You are now verified!`);
            } else {
                console.error("Channel not found.");
            }
        } else {
            console.log(`User already exists in Firestore: ${user.username}`);
        }

        // Assign role to user
        await assignRole(user.id, VERIFIED_ROLE_ID);

        // Generate access token and refresh token for the system
        const accessToken = generateAccessToken(user.id);
        const refreshToken = generateRefreshToken(user.id);

        // Set the access and refresh tokens in cookies
        setTokens(res, accessToken, refreshToken);

        // Redirect to main application
        res.redirect(APP_URL);

    } catch (error) {
        console.error("Error during Discord OAuth2 process:", error.response ? error.response.data : error.message);
        res.status(500).send("Authentication failed");
    }
});

// Endpoint to check if the user is authenticated
app.get("/check", authenticateToken, (req, res) => {
    // If the user is authenticated, send a success message
    res.send({
        loggedIn: true, // Indicate the user is not logged in
        message: "Authenticated",
    });
});

app.get("/check", (req, res) => {
    res.send({
        loggedIn: false, // Indicate the user is not logged in
        message: "Not authenticated",
    });
});

// Logout endpoint
app.post("/logout", (req, res) => {
    res.clearCookie("accessToken", { path: "/", ...cookieDomainOption });
    res.clearCookie("refreshToken", { path: "/", ...cookieDomainOption });
    res.send("Logged out successfully");
});

app.get("/user", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        // Fetch user data from Firestore
        const userRef = db.collection("users").doc(userId);
        const doc = await userRef.get();

        if (!doc.exists) {
            return res.status(404).send("User not found.");
        }

        const userData = doc.data();

        res.send(userData);
    } catch (error) {
        console.error("Error retrieving user data:", error);
        res.status(500).send("An error occurred while retrieving user data.");
    }


});

// Middleware to validate origin
const validateOrigin = (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || isValidOrigin(origin)) {
        next();
        return;
    }
    res.status(403).send("Forbidden: Invalid Origin");
};

app.post("/api/user", validateOrigin, async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).send("Refresh token is required.");
    }

    try {
        // Verifiy the refresh token
        const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET);
        const userId = decoded.userId;

        // Fetch user data fom Firestore
        const userRef = db.collection("users").doc(userId);
        const doc = await userRef.get();

        if (!doc.exists) {
            return res.status(404).send("User not found.");
        }

        const userData = doc.data();

        res.send(userData);
    } catch (error) {
        console.error("Error retrieving user data:", error);
        res.status(403).send("Invalid or expired refresh token.");
    }
});

const MAX_LEVEL = 40;
app.post("/api/user/update/stats", validateOrigin, async (req, res) => {
    const { userId, data } = req.body;

    if (!userId || !data) {
        return res.status(400).send("User ID and data are required.");
    }

    try {
        // Reference the user's document in Firestore
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).send("User not found.");
        }

        const userData = userDoc.data();
        const currentStats = userData.statistics || {};
        const currentAchievements = userData.achievements || {};

        // Merge data into current stats
        const newStats = {
            highscore: (currentStats.highscore || 0) < data.score ? data.score : currentStats.highscore,
            kills: (currentStats.kills || 0) + (data.kills || 0),
            playtime: (currentStats.playtime || 0) + (data.playtime || 0),
        };

        // Calculate level progression
        let progression = userData.progression || { level: 1, xp: 0 };
        progression.xp += data.xp || 0;

        const calculateRequiredXP = (level, baseXP = 50) => {
            return Math.round(baseXP * Math.pow(level, 1.1));
        };

        let skins = userData.skins || {};
        let newUnlockedSkins = [];

        let requiredXP = calculateRequiredXP(progression.level);
        while (progression.xp >= requiredXP && progression.level < MAX_LEVEL) {
            progression.level++;
            progression.xp -= requiredXP;

            // Unlock veteran skins every 5 levels
            if (progression.level % 5 === 0) {
                const baseId = 99;
                const newSkinId = baseId + Math.floor(progression.level / 5);
                skins.unlocked = skins.unlocked || [];
                skins.unlocked.push(newSkinId);
                newUnlockedSkins.push(newSkinId);

            }

            requiredXP = calculateRequiredXP(progression.level);
        }

        // Ensure XP does not exceed the required XP for MAX_LEVEL
        if (progression.level === MAX_LEVEL) {
            progression.xp = Math.min(progression.xp, calculateRequiredXP(MAX_LEVEL));
        }

        // Ensure that updatedAchievement is not undefined before updating Firestore
        const updateData = {
            statistics: newStats,
            progression: progression,
            skins: skins
        };

        const unlockedAchievement = Object.keys(ACHIEVEMENTS).reduce((best, key) => {
            const { scoreRequired, priority, roleId } = ACHIEVEMENTS[key];
            // Check if the score qualifies for this achievement
            if (data.score >= scoreRequired) {
                // Select the achievement with the highest priority
                if (!best || priority > best.priority) {
                    best = { key, roleId, priority };
                }
            }
            return best;
        }, null);
        
        let isNewScoreAchievement;
        if (unlockedAchievement) {
            const currentAchievementPriority = getAchievementDetails(currentAchievements.score)?.priority ?? -1;
            const unlockedPriority = unlockedAchievement?.priority ?? -1;
            isNewScoreAchievement = unlockedPriority > currentAchievementPriority;

            if (isNewScoreAchievement) {
                updateData.achievements = { score: unlockedAchievement.key };
            }
        }

        // Perform Firestore update with the data object
        await userRef.update(updateData);

        if (isNewScoreAchievement) {    
            // Handle role updates in the guild
            const guild = client.guilds.cache.get(GUILD_ID);
            const member = await guild.members.fetch(userId);
            console.log(guild, member)
            if (member) {
                const achievementRoles = Object.values(ACHIEVEMENTS).map(a => a.roleId);
                const rolesToRemove = member.roles.cache.filter(role => achievementRoles.includes(role.id));

                if (rolesToRemove.size > 0) {
                    await member.roles.remove(rolesToRemove);
                }

                const newRoleId = unlockedAchievement.roleId;

                if (newRoleId) {
                    await member.roles.add(newRoleId);
                }
            }

            // Helper function to convert seconds to a readable format
            const formatPlaytime = (seconds) => {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                return `${hours > 0 ? `${hours}h ` : ""}${minutes}min`;
            };

            // Notify the user in the achievement channel
            const channel = await client.channels.fetch(ACHIEVEMENT_CHANNEL_ID);
            if (channel) {
                const roundPlaytimeFormatted = formatPlaytime(data.playtime); // Convert round playtime to human-readable format
                channel.send(
                    `ðŸ† <@${userId}> unlocked a new achievement: **${unlockedAchievement.key}**! (Playtime: **${roundPlaytimeFormatted}**)`
                );
            }
        }

        res.status(200).json({
            message: "Stats and achievements updated successfully.",
            newlyUnlockedSkins: newUnlockedSkins,
        });

    } catch (error) {
        console.error("Error updating stats and achievements:", error);
        res.status(500).send("Internal server error.");
    }
});


// Start the Express server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

