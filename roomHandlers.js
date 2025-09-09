import { rooms, getRoom, getOrCreateRoom } from './roomManager.js';
import { loadRoomFromDB, saveRoomToDB, getRoomsFromDB } from './databaseHelpers.js';
import { updatePlayerProfilePics, createCleanRoomData } from './roomHelpers.js';

function setupRoomHandlers(io, supabase) {
  io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    socket.on("get_rooms", async () => {
      const roomsList = await getRoomsFromDB(supabase);
      socket.emit("rooms_list", roomsList);
    });

    socket.on("join_room", async (roomId, name, userId) => {
      try {
        // Load room from database first
        let dbRoom = await loadRoomFromDB(roomId, supabase);
        if (!dbRoom) {
          console.log(`Room ${roomId} not found in database. Rooms should be pre-created via SQL.`);
          socket.emit("error", "Room not found. Please contact administrator.");
          return;
        }

        // Get or create room in memory
        let room = await getRoom(roomId);
        if (!room) {
          // Create room from database data
          room = {
            id: dbRoom.room_id,
            name: dbRoom.room_name,
            players: [],
            viewers: [],
            pile: [],
            turn: null,
            currentCombination: null,
            gameStarted: dbRoom.game_started,
            winner: null,
            passes: [],
            lastPlayer: null,
            deckShuffled: false,
            round: 1,
            created: Date.now(),
            lastActivity: Date.now()
          };

          // Load players from database
          if (dbRoom.players && Array.isArray(dbRoom.players)) {
            room.players = dbRoom.players.map(player => ({
              id: player.id,
              userId: player.userId,
              name: player.name,
              hand: player.hand || [],
              connected: player.connected || false,
              ready: player.ready || false,
              isBot: player.isBot || false,
              profilePic: player.profilePic || null
            }));
          }

          // Load game state from database
          if (dbRoom.game_state) {
            const gameState = dbRoom.game_state;
            room.pile = gameState.pile || [];
            room.currentCombination = gameState.currentCombination;
            room.turn = gameState.turn;
            room.passes = gameState.passes || [];
            room.lastPlayer = gameState.lastPlayer;
            room.winner = gameState.winner;
            room.round = gameState.round || 1;
            room.deckShuffled = gameState.deckShuffled || false;
          }

          rooms.set(roomId, room);
        }

        socket.join(roomId);

        // Use authenticated user UUID if available
        const authenticatedUserId = userId && userId !== socket.id ? userId : null;

        // Check if player is already in a seat (reconnecting)
        let seatIndex = -1;
        let isReconnecting = false;

        if (authenticatedUserId) {
          // Try to find by userId first
          seatIndex = room.players.findIndex(p => p.userId === authenticatedUserId);
          if (seatIndex !== -1) {
            isReconnecting = true;
          }
        }

        if (!isReconnecting) {
          // Try to find by socket ID
          seatIndex = room.players.findIndex(p => p.id === socket.id);
          if (seatIndex !== -1) {
            isReconnecting = true;
          }
        }

        if (isReconnecting) {
          // Reconnecting to existing player
          room.players[seatIndex].connected = true;
          room.players[seatIndex].id = socket.id; // Update socket ID
        } else {
          // Add new player (unlimited players allowed)
          room.players.push({
            id: socket.id,
            userId: authenticatedUserId,
            name: name,
            hand: [],
            connected: true,
            ready: false,
            isBot: false
          });
        }

        // Save updated room to database
        await saveRoomToDB(room, supabase);

        // Create clean room data for socket emission (avoid circular references)
        const cleanRoomData = createCleanRoomData(room);

        // Broadcast room update
        io.to(roomId).emit("room_update", cleanRoomData);
        socket.emit("room_joined", cleanRoomData);

        // Broadcast updated room list
        const roomsList = await getRoomsFromDB(supabase);
        io.emit("rooms_list", roomsList);

      } catch (error) {
        console.error('Error in join_room handler:', error);
        socket.emit("error", "Failed to join room");
      }
    });

    socket.on("sit_chair", async (roomId, chairIndex) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up
      if (chairIndex < 0 || chairIndex >= 4) return;

      // Ensure room properties are initialized
      if (!room.players) room.players = [];
      if (!room.viewers) room.viewers = [];
      if (!room.chairs) room.chairs = [null, null, null, null];

      // Check if chair is empty
      if (room.chairs[chairIndex] !== null) {
        socket.emit("error", "Chair is occupied");
        return;
      }

      // Find player in viewers
      const viewerIndex = room.viewers.findIndex(v => v.id === socket.id);
      if (viewerIndex === -1) return;

      const viewer = room.viewers[viewerIndex];
      room.viewers.splice(viewerIndex, 1);

      // Add to players and assign chair
      room.players.push({
        id: socket.id,
        userId: viewer.userId, // Use the authenticated user UUID if available
        name: viewer.name,
        hand: [],
        connected: true,
        chair: chairIndex,
        ready: false,
        profilePic: null // Will be updated when user data is fetched
      });

      room.chairs[chairIndex] = socket.id;

      // Reset countdown when someone joins a seat
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
      }
      room.countdownTime = null;

      // Save to database
      await saveRoomToDB(room, supabase);

      // Update profile pictures for players
      await updatePlayerProfilePics(room, supabase);

      // Create clean room data for socket emission
      const cleanRoomData = createCleanRoomData(room);

      io.to(roomId).emit("room_update", cleanRoomData);
    });

    socket.on("stand_up", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

      // Ensure room properties are initialized
      if (!room.players) room.players = [];
      if (!room.viewers) room.viewers = [];
      if (!room.chairs) room.chairs = [null, null, null, null];

      // Find player
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex === -1) return;

      const player = room.players[playerIndex];
      const chairIndex = player.chair;

      // Remove from players
      room.players.splice(playerIndex, 1);
      room.chairs[chairIndex] = null;

      // Reset countdown when someone leaves a seat
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
      }
      room.countdownTime = null;

      // Add back to viewers
      room.viewers.push({
        id: socket.id,
        userId: player.userId, // Use the authenticated user UUID if available
        name: player.name
      });

      // Create clean room data for socket emission
      const cleanRoomData = createCleanRoomData(room);

      io.to(roomId).emit("room_update", cleanRoomData);
    });

    socket.on("toggle_ready", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

      // Ensure room properties are initialized
      if (!room.players) room.players = [];

      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      // Toggle ready status
      player.ready = !player.ready;

      // Reset countdown when someone toggles ready (on or off)
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
      }
      room.countdownTime = null;

      // Check if all connected players are ready
      const connectedPlayers = room.players.filter(p => p.connected);
      const allReady = connectedPlayers.length >= 2 && connectedPlayers.every(p => p.ready);

      if (allReady && !room.gameStarted) {
        // Start 6-second countdown to game start
        room.countdownTime = 6;
        io.to(roomId).emit("countdown_update", room.countdownTime);

        room.countdownInterval = setInterval(() => {
          room.countdownTime--;

          if (room.countdownTime <= 0) {
            // Time's up - start the game automatically
            clearInterval(room.countdownInterval);
            room.countdownInterval = null;
            room.countdownTime = null;

            // Initialize game state
            room.gameStarted = true;
            room.pile = [];
            room.currentCombination = null;
            room.winner = null;
            room.passes = [];
            room.lastPlayer = null;
            room.turn = null;
            room.round = 1;
            room.deckShuffled = true;

            // Reset all players' hands and ready status
            room.players.forEach(player => {
              player.hand = [];
              player.ready = false;
            });

            io.to(roomId).emit("game_started", createCleanRoomData(room));
          } else {
            io.to(roomId).emit("countdown_update", room.countdownTime);
          }
        }, 1000);
      }

      io.to(roomId).emit("room_update", createCleanRoomData(room));
    });
  });
}

export { setupRoomHandlers };