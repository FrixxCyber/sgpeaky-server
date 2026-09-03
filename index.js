require("dotenv").config();

const express = require("express");
const Console = require("./ConsoleUtils");
const CryptoUtils = require("./CryptoUtils");
const SharedUtils = require("./SharedUtils");

const {
  BackendUtils,
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
  VerifyPhoton
} = require("./BackendUtils");

const app = express();

const Title = "Stumble Aura Backend " + process.env.version;
const PORT = process.env.PORT || 8080;

app.use(express.json());


// ============================================================
// CORE.CS COMPATIBILITY
// ============================================================
//
// Core.cs does NOT use the normal authenticated API for these
// requests.
//
// It sends:
//
// POST /
// { "deviceId": "..." }
//
// POST /
// {
//   "deviceId": "...",
//   "username": "...",
//   "country": "..."
// }
//
// POST /
// { "id": 123 }
//
// POST /
// { "userId": 123, "username": "..." }
//
// Therefore these routes MUST be before:
//     app.use(authenticate)
//
// ============================================================


// ------------------------------------------------------------
// CORE: FIND / CREATE / LOGIN / UPDATE USER
// ------------------------------------------------------------

app.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    // ========================================================
    // FIND USER BY DEVICE ID
    //
    // Core.cs:
    // POST /
    // { "deviceId": "..." }
    //
    // Response:
    // { "found": true, "user": {...} }
    //
    // or:
    // { "found": false }
    // ========================================================

    if (
      body.deviceId &&
      !body.username &&
      body.id === undefined &&
      body.userId === undefined
    ) {
      const deviceId = String(body.deviceId);

      const user = await UserModel.findByDeviceId(deviceId);

      if (!user) {
        return res.json({
          found: false
        });
      }

      return res.json({
        found: true,
        user: user
      });
    }


    // ========================================================
    // CREATE USER
    //
    // Core.cs sends a new-user object.
    // ========================================================

    if (
      body.deviceId &&
      body.username &&
      body.id === undefined &&
      body.userId === undefined
    ) {
      const deviceId = String(body.deviceId);

      // Don't create another account if this device already exists.
      const existingUser = await UserModel.findByDeviceId(deviceId);

      if (existingUser) {
        return res.json({
          success: true,
          user: existingUser
        });
      }

      // UserModel.create() already handles the actual database
      // document creation and default values.
      const user = await UserModel.create(deviceId, {
        Version: body.version || body.Version,
        steamTicket: body.steamTicket || body.SteamTicket || "",
        scopelyId: body.scopelyId || body.ScopelyId || ""
      });

      // Apply Core's requested username/country if supplied.
      let finalUser = user;

      try {
        const updates = {};

        if (body.username) {
          updates.username = String(body.username);
        }

        if (body.country) {
          updates.country = String(body.country);
        }

        if (body.gems !== undefined) {
          updates["balances"] = user.balances;
        }

        if (Object.keys(updates).length > 0) {
          finalUser = await UserModel.update(
            user.stumbleId,
            updates
          );
        }
      } catch (updateError) {
        Console.error(
          "CoreCompat",
          "Failed to apply initial user data: " + updateError.message
        );

        // The account was still created, so return the original
        // user instead of failing the entire login.
        finalUser = user;
      }

      return res.json({
        success: true,
        user: finalUser
      });
    }


    // ========================================================
    // LOGIN USER BY ID
    //
    // Core.cs:
    // POST /
    // { "id": 123 }
    // ========================================================

    if (
      body.id !== undefined &&
      body.id !== null &&
      body.deviceId === undefined &&
      body.userId === undefined
    ) {
      const id = Number(body.id);

      if (!Number.isFinite(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid user id"
        });
      }

      const user = await UserModel.findById(id);

      if (!user) {
        return res.json({
          success: false,
          error: "User not found"
        });
      }

      // Core.cs expects the user object directly under "user".
      return res.json({
        success: true,
        user: user
      });
    }


    // ========================================================
    // UPDATE USERNAME
    //
    // Core.cs:
    // POST /
    // {
    //   "userId": 123,
    //   "username": "NewName"
    // }
    // ========================================================

    if (
      body.userId !== undefined &&
      body.userId !== null &&
      body.username !== undefined
    ) {
      const userId = Number(body.userId);
      const username = String(body.username);

      if (!Number.isFinite(userId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid userId"
        });
      }

      if (!username.trim()) {
        return res.status(400).json({
          success: false,
          error: "Username cannot be empty"
        });
      }

      const user = await UserModel.findById(userId);

      if (!user) {
        return res.json({
          success: false,
          error: "User not found"
        });
      }

      const updatedUser = await UserModel.update(
        user.stumbleId,
        {
          username: username
        }
      );

      return res.json({
        success: true,
        username: username,
        user: updatedUser
      });
    }


    // ========================================================
    // UNKNOWN CORE REQUEST
    // ========================================================

    return res.status(400).json({
      success: false,
      error: "Unknown Core request"
    });

  } catch (err) {
    Console.error(
      "CoreCompat",
      "POST / error: " + err.message
    );

    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
});


// ============================================================
// CORE FALLBACK LOGIN
// ============================================================
//
// Core.cs sends:
//
// {
//   "deviceId": "...",
//   "country": "...",
//   "hash": "..."
// }
//
// Your existing UserController.login expects:
//
// DeviceId
// StumbleId
// SteamTicket
// ScopelyId
// Version
// newUsername
//
// So we translate the Core request into the existing format.
// ============================================================

app.post("/user/login", async (req, res, next) => {
  try {
    const body = req.body || {};

    // Already using the normal API format?
    if (body.DeviceId) {
      return UserController.login(req, res);
    }

    // Core.cs format -> normal backend format
    req.body = {
      DeviceId: body.deviceId,
      StumbleId: body.stumbleId || body.StumbleId,
      SteamTicket: body.steamTicket || body.SteamTicket || "",
      ScopelyId: body.scopelyId || body.ScopelyId || "",
      Version: body.version || body.Version || process.env.version || "0.56",
      newUsername: body.username || body.newUsername
    };

    return UserController.login(req, res);

  } catch (err) {
    next(err);
  }
});


// ============================================================
// NORMAL AUTHENTICATED API
// ============================================================

app.use(authenticate);


// ============================================================
// PHOTON
// ============================================================

app.post("/photon/auth", VerifyPhoton);

app.get("/onlinecheck", OnlineCheck);


// ============================================================
// MATCHMAKING
// ============================================================

app.get(
  "/matchmaking/filter",
  MatchmakingController.getMatchmakingFilter
);


// ============================================================
// USER
// ============================================================

app.get("/user/config", sendShared);

app.get(
  "/usersettings",
  UserController.getSettings
);

app.post(
  "/user/updateusername",
  UserController.updateUsername
);

app.get(
  "/user/deleteaccount",
  UserController.deleteAccount
);

app.post(
  "/user/linkplatform",
  UserController.linkPlatform
);

app.post(
  "/user/unlinkplatform",
  UserController.unlinkPlatform
);

app.post(
  "/user/profile",
  UserController.getProfile
);

app.post(
  "/user-equipped-cosmetics/update",
  UserController.updateCosmetics
);

app.post(
  "/user/cosmetics/addskin",
  UserController.addSkin
);

app.post(
  "/user/cosmetics/setequipped",
  UserController.setEquippedCosmetic
);


// ============================================================
// FRIENDS
// ============================================================

app.post(
  "/friends/request/accept",
  FriendsController.add
);

app.delete(
  "/friends/:UserId",
  FriendsController.remove
);

app.get(
  "/friends",
  FriendsController.list
);

app.post(
  "/friends/search",
  FriendsController.search
);

app.post(
  "/friends/request",
  FriendsController.request
);

app.post(
  "/friends/accept",
  FriendsController.accept
);

app.post(
  "/friends/request/decline",
  FriendsController.reject
);

app.post(
  "/friends/cancel",
  FriendsController.cancel
);

app.get(
  "/friends/request",
  FriendsController.pending
);


// ============================================================
// SOCIAL
// ============================================================

app.get(
  "/social/interactions",
  SocialController.getInteractions
);


// ============================================================
// SHARED
// ============================================================

app.get(
  "/shared/:version/:type",
  sendShared
);


// ============================================================
// ROUNDS
// ============================================================

app.get(
  "/round/finish/:round",
  RoundController.finishRound
);

app.get(
  "/round/finishv2/:round",
  RoundController.finishRound
);

app.post(
  "/round/finish/v4/:round",
  RoundController.finishRoundV4
);

app.post(
  "/round/eventfinish/v4/:round",
  RoundController.finishRoundV4
);


// Core-compatible v3 round finish
app.post(
  "/round/finish/v3/:country/:gameId/:userId",
  (req, res, next) => {
    try {
      req.params.round = req.body?.Round;

      return RoundController.finishRoundV4(
        req,
        res,
        next
      );
    } catch (err) {
      next(err);
    }
  }
);


// Custom party round finish
app.post(
  "/round/customroundfinish/:country/:gameId/:userId",
  RoundController.finishCustomRound
);


// Keep compatibility with clients using the accidental
// double-slash route.
app.post(
  "//round/customroundfinish/:country/:gameId/:userId",
  RoundController.finishCustomRound
);


// ============================================================
// BATTLE PASS
// ============================================================

app.get(
  "/battlepass",
  BattlePassController.getBattlePass
);

app.post(
  "/battlepass/claimv3",
  BattlePassController.claimReward
);

app.post(
  "/battlepass/purchase",
  BattlePassController.purchaseBattlePass
);

app.post(
  "/battlepass/complete",
  BattlePassController.completeBattlePass
);


// ============================================================
// ECONOMY
// ============================================================

app.get(
  "/economy/purchase/:item",
  EconomyController.purchase
);

app.get(
  "/economy/purchasegasha/:itemId/:count",
  EconomyController.purchaseGasha
);

app.get(
  "/economy/purchaseluckyspin",
  EconomyController.purchaseLuckySpin
);

app.get(
  "/economy/purchasedrop/:itemId/:count",
  EconomyController.purchaseLuckySpin
);

app.post(
  "/economy/:currencyType/give/:amount",
  EconomyController.giveCurrency
);

app.get(
  "/economy/luckyspin",
  (req, res) => EconomyController.getLuckySpin(req, res)
);


// ============================================================
// MISSIONS
// ============================================================

app.get(
  "/missions",
  MissionsController.getMissions
);

app.post(
  "/missions/:missionId/rewards/claim/v2",
  MissionsController.claimMissionReward
);

app.post(
  "/missions/objective/:objectiveId/:milestoneId/rewards/claim/v2",
  MissionsController.claimMilestoneReward
);


// ============================================================
// GAME EVENTS
// ============================================================

app.get(
  "/game-events/me",
  EventsController.getActive
);


// ============================================================
// NEWS
// ============================================================

app.get(
  "/news/getall",
  NewsController.GetNews
);


// ============================================================
// ANALYTICS
// ============================================================

app.post(
  "/analytics",
  AnalyticsController.analytic
);


// ============================================================
// LEADERBOARD API
// ============================================================

app.get(
  "/highscore/:type/list/",
  async (req, res, next) => {
    try {
      const { type } = req.params;

      const {
        start = 0,
        count = 100,
        country = "global"
      } = req.query;

      const startNum = parseInt(start, 10);
      const countNum = parseInt(count, 10);

      if (!type) {
        return res.status(400).json({
          error: "O tipo é necessário"
        });
      }

      if (
        Number.isNaN(startNum) ||
        Number.isNaN(countNum)
      ) {
        return res.status(400).json({
          error: "Os parâmetros start e count devem ser números"
        });
      }

      const result = await UserModel.GetHighscore(
        type,
        country,
        startNum,
        countNum
      );

      return res.json(result);

    } catch (err) {
      next(err);
    }
  }
);


// ============================================================
// TOURNAMENT X
// ============================================================

app.get(
  "/tournamentx/active",
  TournamentXController.getActive
);

app.get(
  "/tournamentx/active/v2",
  TournamentXController.getActive
);

app.post(
  "/tournamentx/:tournamentId/join",
  TournamentXController.join
);

app.post(
  "/tournamentx/:tournamentId/join/v2",
  TournamentXController.join
);

app.post(
  "/tournamentx/:tournamentId/leave",
  TournamentXController.leave
);

app.post(
  "/tournamentx/:tournamentId/leave/v2",
  TournamentXController.leave
);

app.post(
  "/round/tournament/finish/v2",
  TournamentXController.finish
);


// ============================================================
// API V1
// ============================================================

app.get(
  "/api/v1/ping",
  async (req, res) => {
    res.status(200).send("OK");
  }
);


// IMPORTANT:
// Removed the accidental trailing space that was in:
// /api/v1/userLoginExternal
app.post(
  "/api/v1/userLoginExternal",
  TournamentController.login
);

app.get(
  "/api/v1/tournaments",
  TournamentController.getActive
);


// ============================================================
// ERROR HANDLER
// ============================================================

app.use(errorControll);


// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  const currentDate =
    new Date()
      .toLocaleString()
      .replace(",", " |");

  console.clear();

  Console.log(
    "Server",
    `[${Title}] | ${currentDate} | ${CryptoUtils.SessionToken()}`
  );

  Console.log(
    "Server",
    `Listening on port ${PORT}`
  );
});
