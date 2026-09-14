const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Console = require("./ConsoleUtils");
const dotenv = require('dotenv');
dotenv.config();
const CryptoUtils = require("./CryptoUtils");

const SharedUtils = require("./SharedUtils.js");
const SharedData = require("./shared.json");

const BackendUtils = {
  generateId: () => crypto.randomBytes(16).toString('hex'),
  createHash: (...args) => crypto.createHash('sha256').update(args.join('')).digest('hex'),
  getTimestamp: () => Math.floor(Date.now() / 1000),
  validateAuthHeader: (authHeader) => {
    if (!authHeader || typeof authHeader !== 'string') return null;
    try {
      const parsed = JSON.parse(authHeader);
      if (!parsed.DeviceId) return null;
      return { DeviceId: parsed.DeviceId, StumbleId: parsed.StumbleId };
    } catch {
      return null;
    }
  },
  createLoginHash: (deviceId, version, timestamp, stumbleId, steamTicket, scopelyId) => {
    const hashInput = `${deviceId}${version}${timestamp}${stumbleId || ''}${steamTicket || ''}${scopelyId || ''}${process.env.LeagueSalt}`;
    return crypto.createHash('md5').update(hashInput).digest('hex');
  },
  createRegularHash: (deviceId, googleId, token, timestamp, stumbleId, url, body) => {
    const hashInput = `${deviceId}${googleId}${token}${timestamp}${stumbleId}${url}${body || ''}${process.env.LeagueSalt}`;
    return crypto.createHash('md5').update(hashInput).digest('hex');
  },
  createGameId: (type = 'regular') => {
    const prefix = type === 'event' ? 'EV' : 'RG';
    return `${prefix}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  },
  formatNumber: (num) => {
    return new Intl.NumberFormat('en-US').format(num);
  },
  GenAndroidId: () => {
    return `android-${crypto.randomBytes(8).toString('hex')}`;
  },
  GenCaracters: (length) => {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
  },
  LeagueEncrypt: (text) => {
    const cipher = crypto.createCipheriv('aes-256-cbc', process.env.LeagueSalt, crypto.randomBytes(16));
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
  },
  Hash: (algorithm, data) => {
    return crypto.createHash(algorithm).update(data).digest('hex');
  }
};

class Database {
  constructor() {
    this.mongoUri = process.env.mongoUri;
    this.dbName = 'StumbleLife';
    this.client = null;
    this.db = null;
    this.collections = {
  Users: null,
  Analytics: null,
  News: null,
  Events: null,
  BattlePasses: null,
  Skins: null,
  Missions: null,
  PurchasableItems: null,
  Animations: null,
  Emotes: null,
  Footsteps: null
};
  }

  async connectWithRetry(maxRetries = 5, retryDelay = 5000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        Console.log("Database", `Tentando conectar (tentativa ${attempt}/${maxRetries})...`);
        
        this.client = new MongoClient(this.mongoUri, {
          serverSelectionTimeoutMS: 30000,
          connectTimeoutMS: 30000,
          socketTimeoutMS: 45000,
        });
        
        await this.client.connect();
        this.db = this.client.db(this.dbName);
        this.collections.Users = this.db.collection("Users");
        this.collections.Analytics = this.db.collection("Analytics");
        this.collections.News = this.db.collection("News");
        this.collections.Events = this.db.collection("Events");
        this.collections.BattlePasses = this.db.collection("BattlePasses");
        this.collections.Skins = this.db.collection("Skins");
        this.collections.Missions = this.db.collection("Missions");
        this.collections.PurchasableItems = this.db.collection("PurchasableItems");
        this.collections.Animations = this.db.collection("Animations");
        this.collections.Emotes = this.db.collection("Emotes");
        this.collections.Footsteps = this.db.collection("Footsteps");

        await this.createIndexes();
        await this.autoPopulateSharedData();
        Console.log("Database", "Conectado ao banco de dados com sucesso!");
        return true;
        
      } catch (error) {
        lastError = error;
        Console.error("Database", `Erro na tentativa ${attempt}:`, error.message);
        
        if (attempt < maxRetries) {
          Console.log("Database", `Aguardando ${retryDelay/1000} segundos para tentar novamente...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    throw lastError;
  }

  async connect() {
    return this.connectWithRetry(5, 5000);
  }

async autoPopulateSharedData() {
    try {
        if (SharedData.Skins_v4?.length > 0) {
            await this.collections.Skins.deleteMany({});
            for (const skin of SharedData.Skins_v4) {
                await this.collections.Skins.insertOne({ ...skin });
            }
        }

        if (SharedData.Animations_v2?.length > 0) {
            await this.collections.Animations.deleteMany({});
            for (const anim of SharedData.Animations_v2) {
                await this.collections.Animations.insertOne({ ...anim });
            }
        }

        if (SharedData.Emotes_v2?.length > 0) {
            await this.collections.Emotes.deleteMany({});
            for (const emote of SharedData.Emotes_v2) {
                await this.collections.Emotes.insertOne({ ...emote });
            }
        }

        if (SharedData.Footsteps?.length > 0) {
            await this.collections.Footsteps.deleteMany({});
            for (const footstep of SharedData.Footsteps_v2) {
                await this.collections.Footsteps.insertOne({ ...footstep });
            }
        }

    } catch (error) {
        Console.error('Populate', 'Erro ao popular coleções:', error);
    }
  }
  async createIndexes() {
    await this.collections.Users.createIndexes([
      { key: { deviceId: 1 }, unique: true, sparse: true },
      { key: { stumbleId: 1 }, unique: true, sparse: true },
      { key: { username: 1 }, unique: true, sparse: true },
      { key: { friends: 1 } },
      { key: { sentFriendRequests: 1 } },
      { key: { receivedFriendRequests: 1 } },
      { key: { 'balances.name': 1 } }
    ]);

    await this.collections.Events.createIndex({ StartDateTime: 1, EndDateTime: 1 });
    await this.collections.BattlePasses.createIndex({ PassID: 1 });
    await this.collections.Skins.createIndex({ SkinID: 1 });
  }

  async getUserByQuery(query) {
    return await this.collections.Users.findOne(query);
  }

  async updateUser(query, updates) {
    await this.collections.Users.updateOne(query, { $set: updates });
    return await this.getUserByQuery(query);
  }

  async addToUserArray(query, arrayField, value) {
    return await this.collections.Users.updateOne(query, { $addToSet: { [arrayField]: value } });
  }

  async incrementUserBalance(query, currency, amount) {
    const result = await this.collections.Users.updateOne(
      { ...query, 'balances.name': currency },
      { $inc: { 'balances.$.amount': amount } }
    );

    if (result.matchedCount === 0 && amount > 0) {
      await this.collections.Users.updateOne(
        query,
        { $push: { balances: { name: currency, amount } } }
      );
    }
    return result;
  }

  async createUser(userData) {
    const result = await this.collections.Users.insertOne(userData);
    return { ...userData, _id: result.insertedId };
  }

  async getActiveEvents() {
    const now = new Date();
    return await this.collections.Events.find({
      StartDateTime: { $lte: now },
      EndDateTime: { $gte: now }
    }).toArray();
  }

  async getBattlePass(passId) {
    return await this.collections.BattlePasses.findOne({ PassID: passId });
  }

  async getSkinInfo(skinId) {
    return await this.collections.Skins.findOne({ SkinID: skinId });
  }

  async getMissionInfo(missionId) {
    return await this.collections.Missions.findOne({ Id: missionId });
  }

  async getPurchasableItem(itemId) {
    return await this.collections.PurchasableItems.findOne({ Name: itemId });
  }
}

const database = new Database();
database.connectWithRetry(5, 5000).catch(err => {
  console.error('Database connection error after all retries:', err);
  Console.error("Database", "Verifique se o cluster MongoDB Atlas está online e o IP está liberado.");
  Console.error("Database", "Acesse: https://cloud.mongodb.com -> Network Access -> Add IP Address -> 0.0.0.0/0");
  process.exit(1);
});

class UserModel {

  static async create(deviceId, platformData = {}) {
    const now = new Date();
    const userId = Math.floor(Math.random() * 1000);
    const username = `LifePlayer<color=green><sup>#${userId}`;

    const user = {
      id: userId,
      deviceId,
      stumbleId: BackendUtils.generateId().toUpperCase(),
      username,
      country: 'RO',
      region: 'EU',
      token: CryptoUtils.SessionToken(),
      version: platformData.Version || '0.99',
      createdAt: now,
      lastLogin: now,
      newsVersion: 0,
      skillRating: 0,
      experience: 0,
      crowns: 0,
      hiddenRating: 0,
      isBanned: false,
      inventory: [{
        userId,
        itemId: 803,
        itemType: "DUPLICATE_BANK",
        item: "CONFIG_VERSION",
        amount: 3
      }],
      skins: ["SKIN1", "SKIN2"],
      emotes: ["emote_cry", "emote_hi", "emote_gg", "emote_haha", "emote_happy"],
      animations: ["animation1"],
      footsteps: ["footsteps_smoke"],
      hasBattlePass: false,
      passTokens: 0,
      freePassRewards: [],
      premiumPassRewards: [],
      balances: [
        { name: "coins", amount: 101, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
        { name: "remove_ads", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 2, lastGiven: now },
        { name: "video", amount: 50, secondsSince: 0, secondsPerUnit: 0, maxAmount: 5000, lastGiven: now },
        { name: "gems", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
        { name: "video_gems", amount: 10, secondsSince: 0, secondsPerUnit: 5400, maxAmount: 10, lastGiven: now },
        { name: "video_coins", amount: 8, secondsSince: 0, secondsPerUnit: 10800, maxAmount: 8, lastGiven: now },
        { name: "special_video", amount: 3, secondsSince: 0, secondsPerUnit: 28800, maxAmount: 3, lastGiven: now },
        { name: "skin_charge", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 5, lastGiven: now },
        { name: "skin_purchase", amount: 7, secondsSince: 0, secondsPerUnit: 86400, maxAmount: 7, lastGiven: now },
        { name: "gem_charge", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 3, lastGiven: now },
        { name: "gem_purchase", amount: 1, secondsSince: 0, secondsPerUnit: 86400, maxAmount: 1, lastGiven: now },
        { name: "dust", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
        { name: "default_free_spins", amount: 1, secondsSince: 0, secondsPerUnit: 0, maxAmount: 1, lastGiven: new Date(Date.now() - 86400000) },
        { name: "default_free_ad_spins", amount: 16, secondsSince: 0, secondsPerUnit: 0, maxAmount: 16, lastGiven: new Date(Date.now() - 86400000) },
        { name: "remove_interstitial_ads", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 2, lastGiven: now },
        { name: "end_of_match", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 1, lastGiven: now },
        { name: "end_of_match_event", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 1, lastGiven: now },
        { name: "tournament_ticket_rare", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
        { name: "tournament_ticket_legendary", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
        { name: "video_coins_02", amount: 5, secondsSince: 0, secondsPerUnit: 28800, maxAmount: 5, lastGiven: now },
        { name: "aes", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
        { name: "aec", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
        { name: "ranked_friend_boost", amount: 3, secondsSince: 0, secondsPerUnit: 86400, maxAmount: 3, lastGiven: now },
        { name: "stumble_coins", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now },
        { name: "dust_backup", amount: 0, secondsSince: 0, secondsPerUnit: 0, maxAmount: 0, lastGiven: now }
      ],
      Rewards: [],
      availableNewsVersion: 0,
      latestNewsIdBackend: 11698,
      battlePass: {
        freePassRewards: [],
        premiumPassRewards: [],
        passTokens: 0,
        hasPurchased: false,
        passID: 72,
        secondsToEnd: 904064,
        experience: 0,
        slotsClaimed: [],
        hasUsedDiscount: false,
        xpBooster: 0,
        coins: 0,
        hasUsedBonusDiscount: false,
        passDateId: 0
      },
      secondsSinceCreated: 0,
      age: 0,
      kidFriendlyMode: 0,
      termsOfServiceVersion: 0,
      xpRoad: {
        userId,
        xpRoadId: 0,
        lastClaimedLevel: 1,
        isVeteran: true,
        claimedRewardsIds: [],
        hasBeenEnabled: true,
        currentLevelCap: 70,
        isOnboarding: false,
        onboardingFeaturesUnlocked: []
      },
      userFlags: {
        hasUsedFreeNameChange: false,
        hasCoinConversionPopupShown: false,
        hasCoinConversionCompleted: false
      },
      offerSequenceState: [],
      userProfile: {
        userId,
        userName: username,
        country: 'RO',
        trophies: 0,
        crowns: 0,
        experience: 0,
        hiddenRating: 0,
        isOnline: true,
        lastSeenDate: now.toISOString(),
        skin: "SKIN1",
        nativePlatformName: "android",
        ranked: {
          currentSeasonId: "LIVE_RANKED_SEASON_12",
          currentRankId: 0,
          currentTierIndex: 0
        },
        flags: 0
      },
      featureFlags: [
        "ActionEmotes",
        "ActionEmotesCustomPartyVisibility",
        "age-request",
        "AssignInitialPhotonRegionBasedOnPing",
        "AutomatedShardSources",
        "AvailableCosmetics",
        "BattlePassActivationButton",
        "BattlePassOffer",
        "BattlePassPremiumPopupImprovement",
        "BattlePassSkipButtonOnSections",
        "BattlePassTheme",
        "BattlePassV2",
        "Consensus",
        "ConsoleFreeSpin",
        "CreatorCodes",
        "CreatorsQR",
        "CustomizeEmotesOnCustomPartyLobby",
        "CustomParty",
        "DeltaSharedConfig",
        "DiscoverabilityEvents",
        "DynamicContainer",
        "EndOfMatchRewardedVideo",
        "Events",
        "FriendsList",
        "GameplayAds",
        "GamePlayInGameNotifications",
        "GlobalLTCMetaEvent",
        "GraphicsQualitySettings",
        "HelpshiftConversation",
        "InAppMessageGifting",
        "LateJoinResyncSystem",
        "Leaderboards",
        "LocalNotifications",
        "LootBoxes",
        "MainMenuRevamp",
        "MatchmakingFilter",
        "MemoryFixesSections",
        "MergeParties",
        "Missions",
        "NewMatchmaking",
        "Offerwall",
        "OldPurchaserImplementation",
        "OneStopShop",
        "OneStopShop3dAnimations",
        "OneStopShop3dSkins",
        "OneStopShop3dTaunts",
        "PluginFactory",
        "ProjectVerano",
        "Pusher",
        "QuantumSystemManagement",
        "Ranked",
        "RankedPlayWithFriends",
        "RemoteLocalizations",
        "RoomManagement",
        "RoomManagementConsole",
        "SavePhotonRegionOnBackend",
        "ScopelyAccount",
        "ScopelyAccountApple",
        "SequentialOffers",
        "Shards",
        "ShardsDuplicateBank",
        "ShopOfferCentering",
        "ShopOfferPurchaseLimitIndicator",
        "SimulationGamePayload",
        "SpecialEmoteFilter",
        "StartupNewFlow",
        "StaticBundles",
        "SteamInventory",
        "TransferAppleIdAuthorization",
        "UsePhotonTicketsEvents",
        "UsePhotonTicketsTournamentsX",
        "UserConfiguration",
        "UserGeneratedContent",
        "UserTimeRecords",
        "WebGLRealMoneyOffers",
        "WorkshopCustomThumbnails",
        "XpRoad"
      ],
      googleId: platformData.googleId || '',
      facebookId: platformData.facebookId || '',
      appleId: platformData.appleId || '',
      scopelyId: platformData.scopelyId || '',
      steamTicket: platformData.steamTicket || '',
      equippedCosmetics: {
        skin: 'SKIN1',
        color: 'COLOR1',
        animation: 'animation1',
        footsteps: 'footsteps_smoke',
        emote1: 'emote_cry',
        emote2: 'emote_hi',
        emote3: 'emote_gg',
        emote4: 'emote_haha',
        actionEmote1: 1,
        actionEmote2: 2,
        actionEmote3: 3,
        actionEmote4: 4
      }
    };

    return await database.createUser(user);
  }


  static async findByDeviceId(deviceId) {
    return await database.getUserByQuery({ deviceId });
  }

  static async findByStumbleId(stumbleId) {
    return await database.getUserByQuery({ stumbleId });
  }

  static async findById(id) {
    return await database.getUserByQuery({ id: parseInt(id) });
  }

  static async update(stumbleId, updates) {
    return await database.updateUser({ stumbleId }, updates);
  }

  static async addBalance(deviceId, currency, amount) {
    return await database.incrementUserBalance({ deviceId }, currency, amount);
  }

  static async removeBalance(deviceId, currency, amount) {
    return await database.incrementUserBalance({ deviceId }, currency, -amount);
  }

  static async addSkin(stumbleId, skinId) {
    return await database.addToUserArray({ stumbleId }, 'skins', skinId);
  }

  static async addActionEmote(stumbleId, emoteId) {
    return await database.addToUserArray({ stumbleId }, 'actionEmotes', emoteId);
  }

  static async setEquippedCosmetic(stumbleId, cosmeticType, cosmeticId) {
    const user = await this.findByStumbleId(stumbleId);
    if (!user) throw new Error("User not found");

    const updatedCosmetics = { ...user.equippedCosmetics, [cosmeticType]: cosmeticId };
    return await this.update(stumbleId, { equippedCosmetics: updatedCosmetics });
  }

  static async claimBattlePassSlot(deviceId, slotKey) {
    const user = await this.findByDeviceId(deviceId);
    if (user.battlePass.slotsClaimed.includes(slotKey)) {
      throw new Error("Slot already claimed");
    }

    await database.collections.Users.updateOne(
      { deviceId },
      { $push: { 'battlePass.slotsClaimed': slotKey } }
    );
    return await this.findByDeviceId(deviceId);
  }

  static async addBattlePassExperience(deviceId, xpToAdd) {
    const user = await this.findByDeviceId(deviceId);
    const newXP = (user.battlePass.experience || 0) + xpToAdd;

    await database.collections.Users.updateOne(
      { deviceId },
      { $set: { 'battlePass.experience': newXP } }
    );

    return await this.findByDeviceId(deviceId);
  }

  static async GetHighscore(type, country, start = 0, count = 50) {
    const filter = {};
    const projection = { username: 1, country: 1, _id: 0 };
    let sortField;
    let valueField;

    if (type === "crowns") {
      filter.crowns = { $gt: 0 };
      projection.crowns = 1;
      sortField = "crowns";
      valueField = "Crowns";
    } else if (type === "rank") {
      filter.skillRating = { $gt: 0 };
      projection.skillRating = 1;
      sortField = "skillRating";
      valueField = "SkillRating";
    }

    if (country && country.toLowerCase() !== "") {
      filter.country = country;
    }

    const users = await database.collections.Users
      .find(filter)
      .sort({ [sortField]: -1 })
      .project(projection)
      .skip(parseInt(start))
      .limit(parseInt(count))
      .toArray();

    if (users.length === 0) {
      return { Error: "No users found" };
    }

    const scores = users.map(user => {
      const value = type === "crowns" ? user.crowns : user.skillRating;
      return {
        User: {
          Username: user.username,
          Country: user.country || "Unknown",
          [valueField]: value
        }
      };
    });

    return { scores };
  }

  static async getBalanceAmount(user, currency) {
    const balance = user.balances.find(b => b.name === currency);
    return balance ? balance.amount : 0;
  }

  static async getLevel(xp) {
    return Math.floor((xp + 1032700) / 30000) - 9;
  }
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    req.user = null;

    if (!authHeader) {
      return next();
    }

    let authData;
    try {
      authData = JSON.parse(authHeader);
    } catch (e) {
      return next();
    }

    const { DeviceId, StumbleId } = authData;

    const user = StumbleId
      ? await UserModel.findByStumbleId(StumbleId)
      : await UserModel.findByDeviceId(DeviceId);

    req.user = user;
    next();
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function generatePhotonJwt(user) {
  const payload = {
    stumbleId: user.stumbleId,
    deviceId: user.deviceId,
    username: user.username
  };

  const secret = process.env.LeagueSalt;
  const options = { expiresIn: '30d', issuer: 'LifeLeaguePhoton' };

  return new Promise((resolve, reject) => {
    jwt.sign(payload, secret, options, (err, token) => {
      if (err) reject(err);
      else resolve(token);
    });
  });
}

async function VerifyPhoton(req, res, user) {
  try {
    const tokenFromHeader = req.headers.authorization;
    if (!tokenFromHeader) {
      return res.json({ ResultCode: -1, Message: "Authorization header missing" });
    }

    try {
      const secret = process.env.LeagueSalt;
      const decoded = jwt.verify(tokenFromHeader, secret);

      if (decoded.stumbleId !== user.stumbleId ||
          decoded.deviceId !== user.deviceId ||
          decoded.username !== user.username) {
        return res.json({ ResultCode: -1, Message: "Token validation failed" });
      }

      return res.json({ ResultCode: 1, UserId: tokenFromHeader });
    } catch (err) {
      return res.json({ ResultCode: -1, Message: "Invalid token" });
    }
  } catch (err) {
    Console.error("VerifyPhoon", "Error:", err);
    return res.status(500).json({ ResultCode: -1, Message: "Internal server error" });
  }
}

class UserController {
  static async login(req, res) {
    try {
      const { DeviceId, StumbleId, SteamTicket, ScopelyId, Version, newUsername } = req.body;

      if (!DeviceId) {
        return res.status(400).json({ message: 'DeviceId is required' });
      }

      let user = null;
      if (StumbleId) {
        user = await UserModel.findByStumbleId(StumbleId);
      }

      if (!user) {
        user = await UserModel.findByDeviceId(DeviceId);
      }

      if (!user) {
        Console.log("Login", "Criando novo usuario com o deviceId: " + DeviceId);
        user = await UserModel.create(DeviceId, { steamTicket: SteamTicket, scopelyId: ScopelyId, Version });
      }

      // Se foi enviado um newUsername, atualizar o username do usuário
      if (newUsername && newUsername !== user.username) {
        // Validação básica do username
        if (!/^[a-zA-Z0-9_\s]+$/.test(newUsername)) {
          return res.status(422).json({ message: 'Username can only contain letters, numbers, underscores and spaces' });
        }

        if (newUsername.length < 3 || newUsername.length > 15) {
          return res.status(422).json({ message: 'Username must be between 3 and 15 characters' });
        }

        // Verificar se o username já existe
        const existingUser = await database.getUserByQuery({ username: newUsername });
        if (existingUser && existingUser._id.toString() !== user._id.toString()) {
          return res.status(409).json({ message: 'Username already taken' });
        }

        // Atualizar o username no banco de dados
        user = await UserModel.update(user.stumbleId, { username: newUsername });
        Console.log("Login", "Username atualizado para: " + newUsername + " para usuario: " + user.stumbleId);
      }

      const photonJwt = await generatePhotonJwt(user);

     if (user.isBanned) {
  return res.status(403).send("BANNED");
}

      return res.status(200).json({
        User: user,
        PhotonJwt: photonJwt,
        equippedCosmetics: user.equippedCosmetics
      });
    } catch (err) {
      Console.error('Login', 'Error:', err);
      return res.status(500).json({ message: 'Internal server error during login' });
    }
  }

  static async getConfig(req, res) {
    try {
      const config = {
        _SharedVersion: 2,
        Versions: {
          AndroidLastVersionAvailable: 0.59
        },
        BattlePassRotation: SharedData.BattlePassRotation || [],
        BattlePassesV3: SharedData.BattlePasses || [],
        RoundLevels_v2: SharedData.RoundLevels_v2 || [],
        Skins_v4: SharedData.Skins_v4 || [],
        MissionObjectives: SharedData.MissionObjectives || [],
        PurchasableItems: SharedData.PurchasableItems || [],
        GameEvents: SharedData.GameEvents || [],
        Animations: SharedData.Animations || [],
        Animations_v2: SharedData.Animations_v2 || [],
        AdSettings: SharedData.AdSettings || {},
        AnalyticsSettings: SharedData.AnalyticsSettings || {},
        BackendUrl: SharedData.BackendUrl || "",
        BattlePass: SharedData.BattlePass || {},
        ActionEmotes: SharedData.ActionEmotes || {},
        RankedPlaySettings: SharedData.RankedPlaySettings || {}
      };

      res.json(config);
    } catch (err) {
      Console.error('Config', 'Error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

static async updateUsername(req, res) {
  try {
    const { Username } = req.body;
    const { user } = req;

    // Validação do formato do username
    if (!/^[a-zA-Z0-9_\s]+$/.test(Username)) {
      res.status(422).json({ message: 'Username can only contain letters, numbers, underscores and spaces' });
      return;
    }

    // Verifica se o username já existe
    const existingUser = await database.getUserByQuery({ username: Username });
    if (existingUser) {
      res.status(409).json({ message: 'Username already taken' });
      return;
    }

    // Se todas as validações passarem, atualiza o usuário
    const updatedUser = await UserModel.update(user.stumbleId, { username: Username });
    res.status(200).json({ User: updatedUser });

  } catch (err) {
    console.error('Username', 'Update error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
}


  static async getSettings(req, res) {
    try {
        const settings = {
            friendIsOnlinePush: true,
            invitedToPartyPush: true,
            partyInviteToastNotification: true,
            partyInviteInGameToastNotification: true
        };

        res.json(settings);
    } catch (err) {
        Console.error('Settings', 'Error:', err);
        res.status(500).json({ message: 'Internal server error' });
    }
}

  static async getProfile(req, res) {
    try {
      const { userID } = req.body;
      let user = null;

      if (userID) {
        user = await UserModel.findById(userID);
      }

      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      res.json({
        User: user.userProfile
      });
    } catch (err) {
      Console.error('Profile', 'Get error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async addSkin(req, res) {
    try {
      const { user } = req;
      const { skinId } = req.body;

      if (!skinId) {
        return res.status(400).json({ message: 'skinId is required' });
      }

      await UserModel.addSkin(user.stumbleId, skinId);
      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('Cosmetics', 'Add skin error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async setEquippedCosmetic(req, res) {
    try {
      const { user } = req;
      const { cosmeticType, cosmeticId } = req.body;

      if (!cosmeticType || !cosmeticId) {
        return res.status(400).json({ message: 'Both cosmeticType and cosmeticId are required' });
      }

      const updatedUser = await UserModel.setEquippedCosmetic(user.stumbleId, cosmeticType, cosmeticId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('Cosmetics', 'Set equipped error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async updateCosmetics(req, res) {
    try {
      const { user } = req;
      const {
        skin, color, animation, footsteps,
        emote1, emote2, emote3, emote4,
        actionEmote1, actionEmote2, actionEmote3, actionEmote4
      } = req.body;

      const updates = {
        equippedCosmetics: {
          skin: skin || user.equippedCosmetics.skin,
          color: color || user.equippedCosmetics.color,
          animation: animation || user.equippedCosmetics.animation,
          footsteps: footsteps || user.equippedCosmetics.footsteps,
          emote1: emote1 || user.equippedCosmetics.emote1,
          emote2: emote2 || user.equippedCosmetics.emote2,
          emote3: emote3 || user.equippedCosmetics.emote3,
          emote4: emote4 || user.equippedCosmetics.emote4,
          actionEmote1: actionEmote1 || user.equippedCosmetics.actionEmote1,
          actionEmote2: actionEmote2 || user.equippedCosmetics.actionEmote2,
          actionEmote3: actionEmote3 || user.equippedCosmetics.actionEmote3,
          actionEmote4: actionEmote4 || user.equippedCosmetics.actionEmote4
        }
      };

      const updatedUser = await UserModel.update(user.stumbleId, updates);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('Cosmetics', 'Update error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async deleteAccount(req, res) {
    try {
      const { user } = req;
      const newUsername = `#${BackendUtils.GenCaracters(11)}`;

      await UserModel.update(user.deviceId, { username: newUsername });
      await database.collections.Users.deleteOne({ deviceId: user.deviceId });

      res.json({ message: 'Account deleted successfully' });
    } catch (err) {
      Console.error('Account', 'Delete error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async linkPlatform(req, res) {
    try {
      const { platform, platformId } = req.body;
      const { user } = req;

      const validPlatforms = ['google', 'apple', 'facebook', 'scopely'];
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ message: 'Invalid platform' });
      }

      const platformIdMD5 = BackendUtils.Hash('md5', platformId || `${platform}-${user.username}-${process.env.LeagueSalt}`);
      const updateField = `${platform}Id`;

      const updatedUser = await UserModel.update(user.deviceId, { [updateField]: platformIdMD5 });
      res.json({ User: updatedUser, message: `Successfully linked ${platform} account` });
    } catch (err) {
      Console.error('Platform', 'Link error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async unlinkPlatform(req, res) {
    try {
      const { platform } = req.body;
      const { user } = req;

      const validPlatforms = ['google', 'apple', 'facebook', 'scopely'];
      if (!validPlatforms.includes(platform)) {
        return res.status(400).json({ message: 'Invalid platform' });
      }

      const updateField = `${platform}Id`;
      const updatedUser = await UserModel.update(user.deviceId, { [updateField]: '' });

      res.json({ User: updatedUser, message: `Successfully unlinked ${platform} account` });
    } catch (err) {
      Console.error('Platform', 'Unlink error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

class RoundController {
  static async finishRound(req, res) {
    try {
      const { user } = req;
      const { round } = req.params;

      if (!round) {
        return res.status(400).json({ message: 'Round is required' });
      }

      const rewards = {
        crowns: round === '3' ? 1 : round === '2' ? 0 : 0,
        skillRating: round === '3' ? 20 : round === '2' ? 10 : 0,
        experience: 100
      };

      const updatedUser = await UserModel.update(user.deviceId, {
        crowns: user.crowns + rewards.crowns,
        skillRating: user.skillRating + rewards.skillRating,
        experience: user.experience + rewards.experience
      });

      res.status(200).json({
        User: updatedUser,
        Rewards: rewards
      });
    } catch (err) {
      Console.error('Round', 'Finish error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async finishCustomRound(req, res) {
    try {
      const { user } = req;
      const { round } = req.params;

      res.json({
        User: user,
        message: 'Custom round finished successfully'
      });
    } catch (err) {
      Console.error('Round', 'Custom finish error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async finishRoundV4(req, res) {
    try {
      const { user } = req;
      const { round } = req.params;
      const { gameType, variantId } = req.body;

      const gameId = BackendUtils.createGameId(gameType === 'event' ? 'event' : 'regular');
      const levelIds = SharedData.RoundLevels_v2.map(level => level.LevelID).slice(0, 3);

      const roundPayloads = {};
      const placements = {};
      const eliminatedPlayers = [];
      const usersLastRound = {};

      if (round === '1') {
        placements[user.id] = 16;
        usersLastRound[user.id] = 1;
        roundPayloads = {
          EliminatedPlayers: [user.id, ...Array(15).fill(0).map((_, i) => 1000 + i)],
          LevelId: levelIds[0],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
      } else if (round === '2') {
        placements[user.id] = 8;
        usersLastRound[user.id] = 2;
        roundPayloads = {
          EliminatedPlayers: [],
          LevelId: levelIds[0],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
        roundPayloads[2] = {
          EliminatedPlayers: [user.id, ...Array(7).fill(0).map((_, i) => 1000 + i)],
          LevelId: levelIds,
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
      } else if (round === '3') {
        placements[user.id] = 1;
        usersLastRound[user.id] = 3;
        roundPayloads = {
          EliminatedPlayers: [],
          LevelId: levelIds[0],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
        roundPayloads[2] = {
          EliminatedPlayers: [],
          LevelId: levelIds,
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
        roundPayloads[3] = {
          EliminatedPlayers: [],
          LevelId: levelIds[2],
          Placements: placements,
          RoundMissionProgression: null,
          Type: "SoloRound"
        };
      }

      const clientViewPayload = {
        AverageMmr: null,
        CurrentRound: parseInt(round),
        ExpectedRounds: 3,
        FrameNumber: 7814,
        GameId: gameId,
        GameType: gameType === 'event' ? "Event" : "Regular",
        Placements: null,
        RoundPayloads: roundPayloads,
        StartingUsers: 32,
        UsersLastRound: usersLastRound,
        VariantId: variantId || null
      };

      const rewards = {
        crowns: round === '3' ? 1 : round === '2' ? 0 : 0,
        skillRating: round === '3' ? 20 : round === '2' ? 10 : 0,
        experience: 100
      };

      const updatedUser = await UserModel.update(user.deviceId, {
        crowns: user.crowns + rewards.crowns,
        skillRating: user.skillRating + rewards.skillRating,
        experience: user.experience + rewards.experience
      });

      res.status(200).json({
        ClientViewPayload: clientViewPayload,
        ClientViewPlacements: null,
        FriendsCount: 0,
        LevelIds: levelIds,
        MissionsProgression: {},
        SignedPayload: "",
        User: updatedUser,
        Rewards: rewards
      });
    } catch (err) {
      Console.error('Round', 'FinishV4 error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

class BattlePassController {
  static async getBattlePass(req, res) {
    try {
      const now = new Date();
      const activePass = SharedData.BattlePassRotation.find(pass => {
        const startDate = new Date(pass.StartDate);
        const endDate = new Date(pass.EndDate);
        return startDate <= now && now <= endDate;
      });

      if (!activePass) {
        return res.status(404).json({ message: 'No active battle pass found' });
      }

      const battlePass = SharedData.BattlePasses.find(bp => bp.PassID === activePass.PassID);
      if (!battlePass) {
        return res.status(404).json({ message: 'Battle pass data not found' });
      }

      res.json([battlePass]);
    } catch (err) {
      Console.error('BattlePass', 'Get error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async claimReward(req, res) {
    try {
      const { user } = req;
      const { Page, Section, Slot, IsPremium } = req.body;

      if (Page === undefined || Section === undefined || Slot === undefined) {
        return res.status(400).json({ message: 'Page, Section and Slot are required' });
      }

      const slotKey = `${Page},${Section},${Slot}`;
      if (user.battlePass.slotsClaimed.includes(slotKey)) {
        return res.status(400).json({ message: 'Slot already claimed' });
      }

      await database.collections.Users.updateOne(
        { deviceId: user.deviceId },
        { $push: { 'battlePass.slotsClaimed': slotKey } }
      );

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('BattlePass', 'Claim error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async purchaseBattlePass(req, res) {
    try {
      const { user } = req;

      if (user.battlePass.hasPurchased) {
        return res.status(400).json({ message: 'Battle pass already purchased' });
      }

      const gemsBalance = UserModel.getBalanceAmount(user, 'gems');
      if (gemsBalance < 1200) {
        return res.status(400).json({ message: 'Not enough gems' });
      }

      await UserModel.removeBalance(user.deviceId, 'gems', 1200);
      await UserModel.update(user.deviceId, { 'battlePass.hasPurchased': true });

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('BattlePass', 'Purchase error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async completeBattlePass(req, res) {
    try {
      const { user } = req;
      const battlePass = SharedData.BattlePasses[0];

      if (!battlePass) {
        return res.status(404).json({ message: 'No battle pass data available' });
      }

      const claimedSlots = user.battlePass.slotsClaimed || [];
      const userCoins = user.battlePass.coins || 0;
      const userExperience = user.battlePass.experience || 0;
      const xpToLevelUp = battlePass.XPToLevelUp || 1000;

      const calculateLevel = (experience) => {
        return Math.floor(experience / xpToLevelUp);
      };

      const playerLevel = calculateLevel(userExperience);

      for (const [pageIndex, page] of battlePass.Content.Pages.entries()) {
        for (const [sectionIndex, section] of page.Sections.entries()) {
          const sectionUnlockLevel = section.UnlockLevel || 0;
          if (playerLevel >= sectionUnlockLevel) {
            for (const [slotIndex, slot] of section.Slots.entries()) {
              const slotKey = `${pageIndex},${sectionIndex},${slotIndex}`;
              if (!claimedSlots.includes(slotKey)) {
                if (userCoins >= slot.UnlockCost && (!slot.IsPremium || user.battlePass.hasPurchased)) {
                  await database.collections.Users.updateOne(
                    { deviceId: user.deviceId },
                    { $push: { 'battlePass.slotsClaimed': slotKey } }
                  );
                }
              }
            }
          }
        }
      }

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({ User: updatedUser });
    } catch (err) {
      Console.error('BattlePass', 'Complete error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

class EconomyController {
  static async purchase(req, res) {
    try {
      const { user } = req;
      const itemId = req.params.item;

      const item = SharedData.PurchasableItems.find(i => i.Name === itemId);
      if (!item) return res.status(404).json({ error: 'ITEM_NOT_FOUND' });

      const price = item.Prices[0];
      if (!price) return res.status(400).json({ error: 'INVALID_PRICE' });

      const balance = UserModel.getBalanceAmount(user, price.Currency);
      if (balance < price.Amount) return res.status(402).json({ error: 'INSUFFICIENT_FUNDS' });

      await UserModel.removeBalance(user.stumbleId, price.Currency, price.Amount);

      const rewards = [];
      if (item.Rewards) {
        for (const reward of item.Rewards) {
          if (reward.Type === 'Currency') {
            await UserModel.addBalance(user.stumbleId, reward.CurrencyType, reward.Amount);
            rewards.push({
              type: 'CURRENCY',
              currencyType: reward.CurrencyType,
              amount: reward.Amount
            });
          } else if (reward.Type === 'Cosmetic') {
            await UserModel.addSkin(user.stumbleId, reward.CosmeticId);
            rewards.push({
              type: 'COSMETIC',
              cosmeticType: reward.CosmeticType,
              cosmeticId: reward.CosmeticId
            });
          }
        }
      }

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      res.json({
        success: true,
        user: updatedUser,
        rewards: rewards
      });
    } catch (err) {
      Console.error('Economy', 'Purchase error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  static async purchaseGasha(req, res) {
    try {
      const { user } = req;
      const { itemId } = req.params;

      const gashaItem = SharedData.PurchasableItems.find(i => i.Name === itemId && i.Type === 'Gasha');
      if (!gashaItem) return res.status(404).json({ error: 'GASHA_NOT_FOUND' });

      const price = gashaItem.Prices[0];
      if (!price || price.Currency !== 'Gems') return res.status(400).json({ error: 'INVALID_PRICE' });

      const userGems = UserModel.getBalanceAmount(user, 'Gems');
      if (userGems < price.Amount) return res.status(402).json({ error: 'INSUFFICIENT_GEMS' });

      await UserModel.removeBalance(user.stumbleId, 'Gems', price.Amount);

      const rewards = [];
      const possibleDrops = gashaItem.GashaDrops || [];
      const totalWeight = possibleDrops.reduce((sum, drop) => sum + drop.Weight, 0);

      for (let i = 0; i < (gashaItem.RollCount || 1); i++) {
        const roll = Math.random() * totalWeight;
        let weightSum = 0;

        for (const drop of possibleDrops) {
          weightSum += drop.Weight;
          if (roll <= weightSum) {
            if (drop.Type === 'Currency') {
              await UserModel.addBalance(user.stumbleId, drop.CurrencyType, drop.Amount);
              rewards.push({
                type: 'CURRENCY',
                currencyType: drop.CurrencyType,
                amount: drop.Amount,
                rarity: drop.Rarity
              });
            } else if (drop.Type === 'Cosmetic') {
              await UserModel.addSkin(user.stumbleId, drop.CosmeticId);
              rewards.push({
                type: 'COSMETIC',
                cosmeticType: drop.CosmeticType,
                cosmeticId: drop.CosmeticId,
                rarity: drop.Rarity
              });
            }
            break;
          }
        }
      }

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      res.json({
        success: true,
        user: updatedUser,
        rewards: rewards,
        gashaId: gashaItem.Name
      });
    } catch (err) {
      Console.error('Economy', 'Gasha error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  static async purchaseLuckySpin(req, res) {
    try {
      const { user } = req;
      const spinItem = SharedData.PurchasableItems.find(i => i.Type === 'LuckySpin');
      if (!spinItem) return res.status(404).json({ error: 'SPIN_NOT_CONFIGURED' });

      const freeSpins = UserModel.getBalanceAmount(user, 'FreeSpins');
      const adSpins = UserModel.getBalanceAmount(user, 'AdSpins');

      if (freeSpins <= 0 && adSpins <= 0) {
        return res.status(402).json({ error: 'NO_SPINS_AVAILABLE' });
      }

      const spinType = freeSpins > 0 ? 'FreeSpins' : 'AdSpins';
      await UserModel.removeBalance(user.stumbleId, spinType, 1);

      const possibleRewards = spinItem.SpinRewards || [];
      const totalWeight = possibleRewards.reduce((sum, r) => sum + r.Weight, 0);
      const roll = Math.random() * totalWeight;
      let weightSum = 0;
      let selectedReward = null;

      for (const reward of possibleRewards) {
        weightSum += reward.Weight;
        if (roll <= weightSum) {
          selectedReward = reward;
          break;
        }
      }

      if (selectedReward) {
        if (selectedReward.Type === 'Currency') {
          await UserModel.addBalance(user.stumbleId, selectedReward.CurrencyType, selectedReward.Amount);
        } else if (selectedReward.Type === 'Cosmetic') {
          await UserModel.addSkin(user.stumbleId, selectedReward.CosmeticId);
        }
      }

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);
      res.json({
        success: true,
        user: updatedUser,
        reward: selectedReward,
        spinType: spinType
      });
    } catch (err) {
      Console.error('Economy', 'Spin error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }

  static async giveCurrency(req, res) {
    try {
      const { currencyType, amount } = req.params;
      const { user } = req;

      const validCurrencies = ['Gems', 'Gold', 'Dust', 'FreeSpins', 'AdSpins'];
      if (!validCurrencies.includes(currencyType)) {
        return res.status(400).json({ error: 'INVALID_CURRENCY' });
      }

      const parsedAmount = parseInt(amount);
      if (isNaN(parsedAmount)) {
        return res.status(400).json({ error: 'INVALID_AMOUNT' });
      }

      await UserModel.addBalance(user.stumbleId, currencyType, parsedAmount);
      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      res.json({
        success: true,
        user: updatedUser,
        currencyAdded: {
          type: currencyType,
          amount: parsedAmount
        }
      });
    } catch (err) {
      Console.error('Economy', 'GiveCurrency error:', err);
      res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
    }
  }
}
class AnalyticsController {
  static async analytic(req, res) {
    try {
      const { user } = req;
      const { type, message } = req.body;

      if (!type || !message) {
        return res.status(400).json({ message: 'Type and message are required' });
      }

      await database.collections.Analytics.insertOne({
        DeviceId: user.deviceId,
        type,
        message,
        timestamp: new Date()
      });

      res.status(200).json("OK");
    } catch (err) {
      Console.error("Analytics", "Error:", err);
      res.status(500).json("Error");
    }
  }
}

class FriendsController {
  static async add(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) {
        return res.status(400).json({ ResultCode: -1, Message: 'UserId is required' });
      }

      const friend = await UserModel.findById(UserId);
      if (!friend) {
        return res.status(404).json({ ResultCode: -1, Message: 'User not found' });
      }

      if (user.friends.includes(friend.stumbleId)) {
        return res.status(409).json({ ResultCode: -1, Message: 'Already friends' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $addToSet: { friends: friend.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: friend.stumbleId },
        { $addToSet: { friends: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      return res.status(200).json({
        ResultCode: 1,
        User: updatedUser.userProfile
      });

    } catch (err) {
      Console.error('Friends', 'Add error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }

  static async request(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) {
        return res.status(400).json({ ResultCode: -1, Message: 'UserId is required' });
      }

      const toUser = await UserModel.findById(UserId);
      if (!toUser) {
        return res.status(404).json({ ResultCode: -1, Message: 'User not found' });
      }

      if (user.sentFriendRequests.includes(toUser.stumbleId)) {
        return res.status(409).json({ ResultCode: -1, Message: 'Request already sent' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $addToSet: { sentFriendRequests: toUser.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: toUser.stumbleId },
        { $addToSet: { receivedFriendRequests: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      return res.status(200).json({
        ResultCode: 1,
        User: updatedUser.userProfile
      });

    } catch (err) {
      Console.error('Friends', 'Request error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }

  static async accept(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) {
        return res.status(400).json({ ResultCode: -1, Message: 'UserId is required' });
      }

      const fromUser = await UserModel.findById(UserId);
      if (!fromUser) {
        return res.status(404).json({ ResultCode: -1, Message: 'User not found' });
      }

      if (!user.receivedFriendRequests.includes(fromUser.stumbleId)) {
        return res.status(404).json({ ResultCode: -1, Message: 'No friend request found' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        {
          $pull: { receivedFriendRequests: fromUser.stumbleId },
          $addToSet: { friends: fromUser.stumbleId }
        }
      );

      await database.collections.Users.updateOne(
        { stumbleId: fromUser.stumbleId },
        {
          $pull: { sentFriendRequests: user.stumbleId },
          $addToSet: { friends: user.stumbleId }
        }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      return res.status(200).json({
        ResultCode: 1,
        User: updatedUser.userProfile
      });

    } catch (err) {
      Console.error('Friends', 'Accept error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }

  static async reject(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) {
        return res.status(400).json({ ResultCode: -1, Message: 'UserId is required' });
      }

      const fromUser = await UserModel.findById(UserId);
      if (!fromUser) {
        return res.status(404).json({ ResultCode: -1, Message: 'User not found' });
      }

      if (!user.receivedFriendRequests.includes(fromUser.stumbleId)) {
        return res.status(404).json({ ResultCode: -1, Message: 'No friend request found' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $pull: { receivedFriendRequests: fromUser.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: fromUser.stumbleId },
        { $pull: { sentFriendRequests: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      return res.status(200).json({
        ResultCode: 1,
        User: updatedUser.userProfile
      });

    } catch (err) {
      Console.error('Friends', 'Reject error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }

  static async cancel(req, res) {
    try {
      const { UserId } = req.body;
      const { user } = req;

      if (!UserId) {
        return res.status(400).json({ ResultCode: -1, Message: 'UserId is required' });
      }

      const toUser = await UserModel.findById(UserId);
      if (!toUser) {
        return res.status(404).json({ ResultCode: -1, Message: 'User not found' });
      }

      if (!user.sentFriendRequests.includes(toUser.stumbleId)) {
        return res.status(404).json({ ResultCode: -1, Message: 'No friend request found' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $pull: { sentFriendRequests: toUser.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: toUser.stumbleId },
        { $pull: { receivedFriendRequests: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      return res.status(200).json({
        ResultCode: 1,
        User: updatedUser.userProfile
      });

    } catch (err) {
      Console.error('Friends', 'Cancel error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }

  static async list(req, res) {
    try {
      const { user } = req;

      const friends = await database.collections.Users.find({
        stumbleId: { $in: user.friends || [] }
      }).project({
        userProfile: 1
      }).toArray();

      return res.status(200).json(friends.map(f => f.userProfile));
    } catch (err) {
      Console.error('Friends', 'List error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }

  static async pending(req, res) {
    try {
      const { user } = req;

      const pendingUsers = await database.collections.Users.find({
        stumbleId: { $in: user.receivedFriendRequests || [] }
      }).project({
        userProfile: 1
      }).toArray();

      return res.status(200).json(pendingUsers.map(u => u.userProfile));
    } catch (err) {
      Console.error('Friends', 'Pending error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }

  static async remove(req, res) {
    try {
      const { UserId } = req.params;
      const { user } = req;

      if (!UserId) {
        return res.status(400).json({ ResultCode: -1, Message: 'UserId is required' });
      }

      const friend = await UserModel.findById(UserId);
      if (!friend) {
        return res.status(404).json({ ResultCode: -1, Message: 'User not found' });
      }

      if (!user.friends.includes(friend.stumbleId)) {
        return res.status(404).json({ ResultCode: -1, Message: 'Not friends' });
      }

      await database.collections.Users.updateOne(
        { stumbleId: user.stumbleId },
        { $pull: { friends: friend.stumbleId } }
      );

      await database.collections.Users.updateOne(
        { stumbleId: friend.stumbleId },
        { $pull: { friends: user.stumbleId } }
      );

      const updatedUser = await UserModel.findByStumbleId(user.stumbleId);

      return res.status(200).json({
        ResultCode: 1,
        User: updatedUser.userProfile
      });

    } catch (err) {
      Console.error('Friends', 'Remove error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }

  static async search(req, res) {
    try {
      const { UserName } = req.body;

      if (!UserName || UserName.length < 3) {
        return res.status(400).json({ ResultCode: -1, Message: 'UserName must be at least 3 characters' });
      }

      const user = await database.collections.Users.findOne({
        username: { $regex: UserName, $options: 'i' }
      }).project({
        userProfile: 1
      });

      if (!user) {
        return res.status(404).json({ ResultCode: -1, Message: 'User not found' });
      }

      return res.status(200).json({
        ResultCode: 1,
        User: user.userProfile
      });
    } catch (err) {
      Console.error('Friends', 'Search error:', err);
      return res.status(500).json({ ResultCode: -1, Message: 'Internal server error' });
    }
  }
}

class NewsController {
  static async GetNews(req, res) {
    try {
      const newsList = await database.collections.News
        .find()
        .sort({ timestamp: -1 })
        .toArray();

      const news = newsList.map(news => ({
        Header: news.header,
        Message: news.message,
        TimeStamp: news.timestamp
      }));

      res.json(news);
    } catch (err) {
      Console.error('News', 'Get error:', err);
      res.status(500).json({ message: 'Error fetching news' });
    }
  }
}

class MissionsController {
  static async getMissions(req, res) {
    try {
      const { user } = req;

      const missions = SharedData.MissionObjectives.map(mission => ({
        missionId: mission.Id,
        missionActive: true,
        rewardsClaimed: false,
        requirementProgressions: mission.Requirements.map(req => ({
          requirementId: req.Id,
          completed: Math.random() > 0.5,
          current: Math.floor(Math.random() * req.Target),
          target: req.Target
        }))
      }));

      res.json({
        missionObjectiveProgressionUpdated: {
          missionObjectiveId: "daily",
          currentPoints: Math.floor(Math.random() * 100),
          milestoneProgressions: SharedData.MissionObjectives
            .find(m => m.Id === "daily")?.Milestones.map(milestone => ({
              milestoneId: milestone.MilestoneId,
              claimed: false
            })) || []
        },
        missionsProgressionsUpdated: missions
      });
    } catch (err) {
      Console.error('Missions', 'Get error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async claimMissionReward(req, res) {
    try {
      const { user } = req;
      const { missionId } = req.params;

      const mission = SharedData.MissionObjectives
        .flatMap(m => m.Requirements.map(r => ({ ...r, missionId: m.Id })))
        .find(m => m.missionId === missionId);

      if (!mission) {
        return res.status(404).json({ message: 'Mission not found' });
      }

      const rewards = mission.Rewards || [];
      for (const reward of rewards) {
        if (reward.type === 'CURRENCY') {
          await UserModel.addBalance(user.deviceId, reward.typeInfo, reward.amount);
        }
      }

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({
        User: updatedUser,
        Rewards: rewards,
        message: 'Rewards claimed successfully'
      });
    } catch (err) {
      Console.error('Missions', 'Claim error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async claimMilestoneReward(req, res) {
    try {
      const { user } = req;
      const { objectiveId, milestoneId } = req.params;

      const objective = SharedData.MissionObjectives.find(m => m.Id === objectiveId);
      if (!objective) {
        return res.status(404).json({ message: 'Objective not found' });
      }

      const milestone = objective.Milestones.find(m => m.MilestoneId === milestoneId);
      if (!milestone) {
        return res.status(404).json({ message: 'Milestone not found' });
      }

      const rewards = milestone.Rewards || [];
      for (const reward of rewards) {
        if (reward.type === 'CURRENCY') {
          await UserModel.addBalance(user.deviceId, reward.typeInfo, reward.amount);
        }
      }

      const updatedUser = await UserModel.findByDeviceId(user.deviceId);
      res.json({
        User: updatedUser,
        Rewards: rewards,
        message: 'Milestone rewards claimed successfully'
      });
    } catch (err) {
      Console.error('Missions', 'Claim milestone error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}

class TournamentXController {
  static tournaments = [
    {
      id: 1,
      type: 1,
      isEnabled: true,
      minVersion: "0.56",
      startTime: new Date(),
      endTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      nameKey: "Peaky 1v1",
      descriptionKey: "Practice your skills in the Peaky 1v1 TournamentX! mode!",
      listItemBackgroundImage: "SharkTanic_Background_Image_Tournaments_Card",
      detailsPanelBackgroundImage: "SharkTanic_Background_Image_Tournaments",
      prizeBannerColour: "#00fd5d",
      headerColour: "#00fd5d",
      mapListGradientColourTop: "#00fd5d",
      mapListGradientColourBottom: "#006d24",
      listPriority: 1,
      minPlayers: 2,
      maxPlayers: 2,
      maxRounds: 1,
      minMatchmakingSeconds: 2,
      entryCurrencyType: "gems",
      entryCurrencyCost: 0,
      areEmotesRestricted: false,
      prohibitedEmotes: [8, 13, 55, 122, 123, 124],
      detailsPanelBorderColourTop: "#008011",
      detailsPanelBorderColourBottom: "#000000",
      colourData: {
        detailsPanelMainColour: "#006600",
        detailsPanelBorderColour: "#043b04",
        headerGradientRight: "#05410d",
        headerGradientLeft: "#0b5e0b",
        infoWidgetsGradientRight: "#c9d0d6",
        infoWidgetsGradientLeft: "#759c75",
        infoWidgetsBorderColour: "#d7d8d8"
      },
      rounds: [
        {
          roundOrder: 1,
          maxPlayersToProgress: 1,
          minPlayersPerMatch: 2,
          maxPlayersPerMatch: 2,
          areLevelsRestricted: true,
          permittedLevels: ["level19_block"]
        }
      ],
      awards: [
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 1, type: "XP", amount: 200 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 2, type: "TROPHIES", amount: 15 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 3, type: "TOURNAMENTXP", amount: 50 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 4, type: "CROWNS", amount: 1 }
          ],
      players: [],
      partys: []
    },
    {
      id: 2,
      type: 1,
      isEnabled: true,
      minVersion: "0.56",
      startTime: new Date(),
      endTime: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      nameKey: "Peaky 2v2 ",
      descriptionKey: "Practice your skills in the Peaky 2v2 TournamentX! mode!",
      listItemBackgroundImage: "AbductedAvenue_Background_Image_Tournaments_Card",
      detailsPanelBackgroundImage: "Barbie_Background_Image_Tournaments",
      prizeBannerColour: "#0bc40b",
      headerColour: "#009900",
      mapListGradientColourTop: "#009900",
      mapListGradientColourBottom: "#009900",
      listPriority: 0,
      minPlayers: 4,
      maxPlayers: 4,
      maxRounds: 1,
      minMatchmakingSeconds: 2,
      entryCurrencyType: "gems",
      entryCurrencyCost: 0,
      areEmotesRestricted: false,
      prohibitedEmotes: [7],
      detailsPanelBorderColourTop: "#009900",
      detailsPanelBorderColourBottom: "#009900",
      colourData: {
        detailsPanelMainColour: "#009900",
        detailsPanelBorderColour: "#009900",
        headerGradientRight: "#009900",
        headerGradientLeft: "#009900",
        infoWidgetsGradientRight: "#009900",
        infoWidgetsGradientLeft: "#009900",
        infoWidgetsBorderColour: "#009900"
      },
      rounds: [
        {
          roundOrder: 1,
          maxPlayersToProgress: 1,
          minPlayersPerMatch: 2,
          maxPlayersPerMatch: 2,
          areLevelsRestricted: true,
          permittedLevels: ["eventlevel13_block_legendary"]
        }
      ],
      awards: [
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 1, type: "XP", amount: 200 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 2, type: "TROPHIES", amount: 15 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 3, type: "TOURNAMENTXP", amount: 50 },
            { placementRangeLowest: 1, placementRangeHighest: 1, awardId: 4, type: "CROWNS", amount: 1 }
          ],
      players: [],
      partys: []
    }
  ];

  static getActive(req, res) {
    try {
      const now = new Date();
      res.status(200).json(TournamentXController.tournaments);
    } catch (err) {
      console.error("erro:", err);
      res.status(500).json({ message: "erro interno" });
    }
  }

  static async join(req, res) {
    try {
      const { user } = req;
      const tournamentId = parseInt(req.params.tournamentId);
      const tournament = TournamentXController.tournaments.find(t => t.id === tournamentId);

      if (!tournament) {
        return res.status(404).json({ message: "torneio nao encontrado" });
      }

      if (!tournament.isEnabled) {
        return res.status(400).json({ message: "torneio desativado" });
      }

      const now = new Date();
      if (now < tournament.startTime || now > tournament.endTime) {
        return res.status(400).json({ message: "torneio nao esta ativo no momento" });
      }

      if (tournament.entryCurrencyCost > 0) {
        const userBalance = UserModel.getBalanceAmount(user, tournament.entryCurrencyType);
        if (userBalance < tournament.entryCurrencyCost) {
          return res.status(400).json({
            message: `saldo insuficiente de ${tournament.entryCurrencyType}`
          });
        }

        await UserModel.removeBalance(user.deviceId, tournament.entryCurrencyType, tournament.entryCurrencyCost);
      }

      tournament.players.push({
        stumbleId: user.stumbleId,
        userId: user.id,
        username: user.username
      });

      const entryToken = `tournament-${tournament.id}-${Date.now()}`;
      const expiryDate = tournament.endTime.toISOString();

      const maps = [];
      const roundsQualified = [];

      if (Array.isArray(tournament.rounds)) {
        for (const round of tournament.rounds) {
          if (Array.isArray(round.permittedLevels)) {
            round.permittedLevels.forEach(lvl => maps.push({ id: lvl }));
          }
          if (round.maxPlayersToProgress) {
            roundsQualified.push(round.maxPlayersToProgress);
          }
        }
      }

      if (!Array.isArray(tournament.partys)) {
        tournament.partys = [];
      }

      const maxPlayers = tournament.maxPlayers || 2;
      let partyId;
      let MatchmakerTag;
      let found = false;

      for (const partyList of tournament.partys) {
        for (const party of partyList) {
          if (party.players.length < maxPlayers) {
            party.players.push(user.stumbleId);
            MatchmakerTag = party.partyId;
            partyId = party.partyId;
            found = true;
            break;
          }
        }
        if (found) break;
      }

      if (!found) {
        const newParty = {
          partyId: `tournament-${tournament.id}-${Math.floor(Math.random() * 9999)}`,
          players: [user.stumbleId]
        };
        tournament.partys.push([newParty]);
        MatchmakerTag = newParty.partyId;
        partyId = newParty.partyId;
      }

      const response = {
        entryToken,
        MatchmakerTag,
        requestId: user.stumbleId
      };

      console.log(`coloquei o ${user.username} na partida ${partyId} no torneio ${tournament.nameKey} com id ${tournament.id} e token ${entryToken}`);
      res.status(200).json(response);
    } catch (err) {
      console.error("erro ao entrar no torneio:", err);
      res.status(500).json({ message: "erro interno do servidor" });
    }
  }

  static async leave(req, res) {
    try {
      const { user } = req;
      const tournamentId = parseInt(req.params.tournamentId);
      const tournament = TournamentXController.tournaments.find(t => t.id === tournamentId);

      if (!tournament) {
        return res.status(404).json({ message: "torneio nao encontrado" });
      }

      const playerIndex = tournament.players.findIndex(p => p.stumbleId === user.stumbleId);
      if (playerIndex !== -1) {
        tournament.players.splice(playerIndex, 1);
        if (tournament.entryCurrencyCost > 0) {
          await UserModel.addBalance(user.deviceId, tournament.entryCurrencyType, tournament.entryCurrencyCost);
        }
      }

      res.status(200).json({ message: "saiu" });
    } catch (err) {
      console.error("tournamentx", "erro ao sair do torneio:", err);
      res.status(500).json({ message: "erro interno do servidor" });
    }
  }

static async finish(req, res) {
  try {
    const { Round, TournamentId, EntryToken, SignedPayload } = req.body;
    const { user } = req;

    if (typeof Round === 'undefined') {
      return res.status(400).json({ mensagem: "precisa do round" });
    }

    if (!user || !user.stumbleId || !user.userProfile) {
      return res.status(400).json({ mensagem: "user invalido" });
    }

    const roundResult = parseInt(Round);
    if (isNaN(roundResult)) {
      return res.status(400).json({ mensagem: "round invalido" });
    }

    let gemsChange = 0;
    let crownsChange = 0;
    let pointsChange = 0;

    if (roundResult === 1) {
      gemsChange = 65;
      crownsChange = 1;
      pointsChange = 10;
    } else if (roundResult === 0) {
      crownsChange = -1;
      pointsChange = -10;
    }

    const currentCrowns = parseInt(user.userProfile.crowns) || 0;
    const currentTrophies = parseInt(user.userProfile.trophies) || 0;
    const currentSkill = parseInt(user.skillRating) || 0;

    const updatedUserProfile = {
      ...user.userProfile,
      crowns: Math.max(0, currentCrowns + crownsChange),
      trophies: Math.max(0, currentTrophies + pointsChange)
    };

    await UserModel.update(user.stumbleId, {
      crowns: Math.max(0, currentCrowns + crownsChange),
      skillRating: Math.max(0, currentSkill + pointsChange),
      userProfile: updatedUserProfile
    });

    if (gemsChange > 0) {
      await UserModel.addBalance(user.deviceId, "gems", gemsChange);
    }

    console.log("Finalizei o round do " + user.username);

    res.status(200).json({
      TournamentId,
      Round: roundResult,
      EntryToken,
      SignedPayload,
      CollectedCurrencies: gemsChange > 0 ? ["gems", gemsChange] : []
    });

  } catch (err) {
    console.error("erro ao finalizar round de tourx:", err);
    res.status(500).json({ mensagem: "erro interno do servidor" });
  }
}
}

class MatchmakingController {
  static async getMatchmakingFilter(req, res) {
    try {
      const { deviceId } = req.query;

      if (!deviceId) {
        return res.status(400).json({
          error: "Bad Request",
          message: "deviceId query parameter is required"
        });
      }

      const user = await UserModel.findByDeviceId(deviceId);

      if (!user) {
        return res.status(404).json({
          error: "Not Found",
          message: "User not found"
        });
      }

      const sharedType = process.env.sharedType || 'NULL';
      const version = user.version || '0';
      const platform = user.userProfile?.nativePlatformName || 'null';
      const skillTier = Math.floor((user.skillRating || 0) / 1000);
      const regionCodes = ['na', 'eu', 'as', 'sa', 'af', 'oc', 'ae'];
      const region = regionCodes[Math.floor(Math.random() * regionCodes.length)];

      const matchmakingFilter = `${sharedType}_${version}_${platform}_${skillTier}_${region}`;

      return res.status(200).json({ matchmakingFilter });

    } catch (err) {
      Console.error('Matchmaking', 'Filter error:', err);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "An error occurred while generating matchmaking filter"
      });
    }
  }
}


class SocialController {
  static async getInteractions(req, res) {
    try {
      const { user } = req;

      const friendIds = user.friends || [];
      const friends = await database.collections.Users.find({ stumbleId: { $in: friendIds } })
        .project({
          id: 1,
          username: 1,
          stumbleId: 1,
          country: 1,
          skillRating: 1,
          crowns: 1,
          experience: 1,
          'equippedCosmetics.skin': 1,
          lastLogin: 1
        })
        .toArray();

      const friendProfiles = friends.map(friend => ({
        userId: friend.id,
        userName: friend.username,
        title: "",
        country: friend.country,
        trophies: friend.skillRating,
        crowns: friend.crowns,
        experience: friend.experience,
        hiddenRating: Math.floor(friend.skillRating / 10),
        isOnline: true,
        lastSeenDate: friend.lastLogin.toISOString(),
        skin: friend.equippedCosmetics?.skin || 'SKIN1',
        nativePlatformName: "android",
        ranked: {
          currentSeasonId: "LIVE_RANKED_SEASON_12",
          currentRankId: 0,
          currentTierIndex: 0
        },
        flags: 0
      }));


      const receivedRequests = user.receivedFriendRequests || [];
      const pendingUsers = await database.collections.Users.find({
        stumbleId: { $in: receivedRequests }
      }).project({
        id: 1,
        username: 1,
        country: 1,
        skillRating: 1,
        crowns: 1,
        experience: 1,
        'equippedCosmetics.skin': 1,
        lastLogin: 1
      }).toArray();

      const friendRequestProfiles = pendingUsers.map(u => ({
        userId: u.id,
        userName: u.username,
        title: "",
        country: u.country,
        trophies: u.skillRating,
        crowns: u.crowns,
        experience: u.experience,
        hiddenRating: Math.floor(u.skillRating / 10),
        isOnline: true,
        lastSeenDate: u.lastLogin.toISOString(),
        skin: u.equippedCosmetics?.skin || 'SKIN1',
        nativePlatformName: "android",
        ranked: {
          currentSeasonId: "LIVE_RANKED_SEASON_12",
          currentRankId: 0,
          currentTierIndex: 0
        },
        flags: 0
      }));


      const recommendedUsers = await database.collections.Users.aggregate([
        { $match: {
          stumbleId: { $nin: [...friendIds, ...receivedRequests, user.stumbleId] },
          country: { $exists: true }
        }},
        { $sample: { size: 5 } },
        { $project: {
          id: 1,
          username: 1,
          country: 1,
          skillRating: 1,
          crowns: 1,
          experience: 1,
          'equippedCosmetics.skin': 1,
          lastLogin: 1
        }}
      ]).toArray();

      const recommendedProfiles = recommendedUsers.map(u => {
        const tags = [];
        if (u.country === user.country) tags.push("SAME_COUNTRY");
        if (Math.abs((u.skillRating || 0) - (user.skillRating || 0)) < 200) tags.push("SIMILAR_SKILL");

        return {
          tags: tags.length > 0 ? tags : ["SIMILAR_SKILL"],
          userProfile: {
            userId: u.id,
            userName: u.username,
            title: "",
            country: u.country,
            trophies: u.skillRating,
            crowns: u.crowns,
            experience: u.experience,
            hiddenRating: Math.floor(u.skillRating / 10),
            isOnline: true,
            lastSeenDate: u.lastLogin.toISOString(),
            skin: u.equippedCosmetics?.skin || 'SKIN1',
            nativePlatformName: "android",
            ranked: {
              currentSeasonId: "LIVE_RANKED_SEASON_12",
              currentRankId: 0,
              currentTierIndex: 0
            },
            flags: 0
          }
        };
      });

      res.json({
        friends: friendProfiles,
        friendRequests: friendRequestProfiles,
        partyInvites: [],
        recommendedFriends: recommendedProfiles
      });
    } catch (err) {
      Console.error('Social', 'Interactions error:', err);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
}


class TournamentController {
    static async login(req, res) {
        try {
            const user = await UserModel.findByDeviceId(req.user.deviceId);
            const photonJwt = await generatePhotonJwt(user);

            return res.json({
                User: user,
                PhotonJwt: photonJwt,
                equippedCosmetics: user.equippedCosmetics
            });

        } catch (error) {
            Console.error('TournamentLogin', error);
            return res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async createTournament(req, res) {
        try {
            const { name, description, startTime, endTime, entryFee, maxPlayers, rewards } = req.body;

            if (!name || !startTime || !endTime) {
                return res.status(400).json({ message: 'Name, startTime and endTime are required' });
            }

            const tournament = {
                id: uuidv4(),
                name,
                description: description || "",
                startTime: new Date(startTime),
                endTime: new Date(endTime),
                entryFee: entryFee || 0,
                maxPlayers: maxPlayers || 1000,
                currentPlayers: 0,
                rewards: rewards || [],
                createdAt: new Date(),
                updatedAt: new Date(),
                isActive: true
            };

            const result = await database.collections.Tournaments.insertOne(tournament);

            if (result.acknowledged) {
                res.status(201).json({
                    message: 'Tournament created successfully',
                    tournament
                });
            } else {
                throw new Error('Failed to create tournament');
            }
        } catch (err) {
            Console.error('Tournament', 'Create error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async getActive(req, res) {
        try {
            const now = new Date();
            const activeTournaments = await database.collections.Tournaments.find({
                startTime: { $lte: now },
                endTime: { $gte: now },
                isActive: true
            }).sort({ startTime: 1 }).toArray();

            res.json(activeTournaments);
        } catch (err) {
            Console.error('Tournament', 'Get active error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async getTournamentById(req, res) {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const tournament = await database.collections.Tournaments.findOne({ id });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            res.json(tournament);
        } catch (err) {
            Console.error('Tournament', 'Get by ID error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async joinTournament(req, res) {
        try {
            const { user } = req;
            const { tournamentId } = req.params;

            if (!tournamentId) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const tournament = await database.collections.Tournaments.findOne({
                id: tournamentId,
                isActive: true
            });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found or inactive' });
            }

            const now = new Date();
            if (now < tournament.startTime) {
                return res.status(400).json({ message: 'Tournament has not started yet' });
            }

            if (tournament.currentPlayers >= tournament.maxPlayers) {
                return res.status(400).json({ message: 'Tournament is full' });
            }

            const existingParticipation = await database.collections.TournamentParticipants.findOne({
                tournamentId,
                userId: user.id
            });

            if (existingParticipation) {
                return res.status(400).json({ message: 'You have already joined this tournament' });
            }

            if (tournament.entryFee > 0) {
                const userBalance = UserModel.getBalanceAmount(user, 'gems');
                if (userBalance < tournament.entryFee) {
                    return res.status(400).json({ message: 'Not enough gems to join tournament' });
                }

                await UserModel.removeBalance(user.stumbleId, 'gems', tournament.entryFee);
            }

            await database.collections.TournamentParticipants.insertOne({
                id: uuidv4(),
                tournamentId,
                userId: user.id,
                username: user.username,
                joinTime: new Date(),
                score: 0,
                position: 0,
                rewardsClaimed: false
            });

            await database.collections.Tournaments.updateOne(
                { id: tournamentId },
                { $inc: { currentPlayers: 1 } }
            );

            res.json({
                message: 'Successfully joined tournament',
                tournamentId,
                entryFeePaid: tournament.entryFee
            });

        } catch (err) {
            Console.error('Tournament', 'Join error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async submitTournamentScore(req, res) {
        try {
            const { user } = req;
            const { tournamentId } = req.params;
            const { score } = req.body;

            if (!tournamentId) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            if (typeof score !== 'number' || score < 0) {
                return res.status(400).json({ message: 'Invalid score' });
            }

            const tournament = await database.collections.Tournaments.findOne({
                id: tournamentId,
                isActive: true
            });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found or inactive' });
            }

            const participation = await database.collections.TournamentParticipants.findOne({
                tournamentId,
                userId: user.id
            });

            if (!participation) {
                return res.status(400).json({ message: 'You did not participate in this tournament' });
            }

            await database.collections.TournamentParticipants.updateOne(
                { id: participation.id },
                { $set: { score: Math.max(participation.score, score) } }
            );

            res.json({
                message: 'Score submitted successfully',
                tournamentId,
                newScore: score,
                previousScore: participation.score
            });

        } catch (err) {
            Console.error('Tournament', 'Submit score error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async getTournamentLeaderboard(req, res) {
        try {
            const { tournamentId } = req.params;
            const { limit = 50 } = req.query;

            if (!tournamentId) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const tournament = await database.collections.Tournaments.findOne({
                id: tournamentId
            });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const leaderboard = await database.collections.TournamentParticipants
                .find({ tournamentId })
                .sort({ score: -1 })
                .limit(parseInt(limit))
                .project({
                    id: 1,
                    userId: 1,
                    username: 1,
                    score: 1,
                    position: 1
                })
                .toArray();

            if (leaderboard.length > 0) {
                let currentPosition = 1;
                let previousScore = leaderboard[0].score;

                for (let i = 0; i < leaderboard.length; i++) {
                    if (leaderboard[i].score < previousScore) {
                        currentPosition = i + 1;
                        previousScore = leaderboard[i].score;
                    }
                    leaderboard[i].position = currentPosition;
                }

                await Promise.all(leaderboard.map(async (entry, index) => {
                    await database.collections.TournamentParticipants.updateOne(
                        {
                            tournamentId,
                            userId: entry.userId
                        },
                        { $set: { position: entry.position } }
                    );
                }));
            }

            res.json({
                tournamentId,
                tournamentName: tournament.name,
                leaderboard
            });

        } catch (err) {
            Console.error('Tournament', 'Leaderboard error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async claimTournamentRewards(req, res) {
        try {
            const { user } = req;
            const { tournamentId } = req.params;

            if (!tournamentId) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const tournament = await database.collections.Tournaments.findOne({
                id: tournamentId
            });

            if (!tournament) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const now = new Date();
            if (now < tournament.endTime) {
                return res.status(400).json({ message: 'Tournament has not ended yet' });
            }

            const participation = await database.collections.TournamentParticipants.findOne({
                tournamentId,
                userId: user.id
            });

            if (!participation) {
                return res.status(400).json({ message: 'You did not participate in this tournament' });
            }

            if (participation.rewardsClaimed) {
                return res.status(400).json({ message: 'You have already claimed your rewards' });
            }

            const reward = tournament.rewards.find(r =>
                participation.position >= r.positionRangeLowest &&
                participation.position <= r.positionRangeHighest
            );

            if (!reward) {
                return res.status(400).json({ message: 'No rewards available for your position' });
            }

            switch (reward.type) {
                case 'crowns':
                    await UserModel.addBalance(user.stumbleId, 'crowns', reward.amount);
                    break;
                case 'gems':
                    await UserModel.addBalance(user.stumbleId, 'gems', reward.amount);
                    break;
                case 'skins':
                    await UserModel.addSkin(user.stumbleId, reward.skinId);
                    break;
            }

            await database.collections.TournamentParticipants.updateOne(
                { id: participation.id },
                { $set: { rewardsClaimed: true } }
            );

            res.json({
                message: 'Rewards claimed successfully',
                rewards: reward
            });

        } catch (err) {
            Console.error('Tournament', 'Claim rewards error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async updateTournament(req, res) {
        try {
            const { id } = req.params;
            const updates = req.body;

            if (!id) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({ message: 'No updates provided' });
            }

            updates.updatedAt = new Date();

            const result = await database.collections.Tournaments.updateOne(
                { id },
                { $set: updates }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            const updatedTournament = await database.collections.Tournaments.findOne({ id });

            res.json({
                message: 'Tournament updated successfully',
                tournament: updatedTournament
            });

        } catch (err) {
            Console.error('Tournament', 'Update error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }

    static async endTournament(req, res) {
        try {
            const { id } = req.params;

            if (!id) {
                return res.status(400).json({ message: 'Tournament ID is required' });
            }

            const result = await database.collections.Tournaments.updateOne(
                { id },
                {
                    $set: {
                        isActive: false,
                        endTime: new Date(),
                        updatedAt: new Date()
                    }
                }
            );

            if (result.matchedCount === 0) {
                return res.status(404).json({ message: 'Tournament not found' });
            }

            res.json({ message: 'Tournament ended successfully' });

        } catch (err) {
            Console.error('Tournament', 'End error:', err);
            res.status(500).json({ message: 'Internal server error' });
        }
    }
}

class EventsController {
  static async getActive(req, res) {
    try {
      const now = new Date();
      const activeEvents = (SharedData.GameEvents || []).filter(event => {
        const startDate = new Date(event.StartDateTime);
        const endDate = new Date(event.EndDateTime);
        return startDate <= now && now <= endDate;
      });

      res.json({ gameEvents: activeEvents});
    } catch (err) {
      Console.error('GameEvents', 'Error:', err);
      res.status(500).json([]);
    }
  }
}
function errorControll(err, req, res, next) {
  Console.error('Unhandled', 'Error:', err);
  res.status(500).json({ message: 'Internal server error' });
}

async function sendShared(req, res) {
  try {
    const filePath = path.resolve(__dirname, "bundles", "shared.bundle");
    const data = await fs.promises.readFile(filePath);
    res.status(200).send(data);
  } catch {
    res.sendStatus(500);
  }
}

async function OnlineCheck(req, res) {
  res.status(200).send("OK");
}

module.exports = {
  BackendUtils,
  Database,
  UserModel,
  UserController,
  RoundController,
  BattlePassController,
  EconomyController,
  AnalyticsController,
  FriendsController,
  NewsController,
  MissionsController,
  TournamentXController,
  MatchmakingController,
  TournamentController,
  SocialController,
  EventsController,
  authenticate,
  errorControll,
  sendShared,
  OnlineCheck,
  VerifyPhoton,
  generatePhotonJwt
};
